const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');
const { pipeline } = require('stream/promises');

const DATA_DIR = path.resolve(process.env.SADOVNIK_DATA_DIR || path.join(__dirname, '..', 'data'));
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const HIDDEN_REPORTS_PATH = path.join(REPORTS_DIR, '.hidden-report-ids.json');
const ZIP_LIMITS = {
  maxEntries: Number(process.env.SADOVNIK_MAX_ZIP_ENTRIES || 512),
  maxEntryBytes: Number(process.env.SADOVNIK_MAX_ZIP_ENTRY_BYTES || 25 * 1024 * 1024),
  maxTotalBytes: Number(process.env.SADOVNIK_MAX_ZIP_TOTAL_BYTES || 100 * 1024 * 1024),
  maxPathDepth: Number(process.env.SADOVNIK_MAX_ZIP_PATH_DEPTH || 5),
  maxPathLength: Number(process.env.SADOVNIK_MAX_ZIP_PATH_LENGTH || 180)
};
const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];
const STAGE_ALIASES = {
  introduction: STAGE_ORDER[0],
  initiation: STAGE_ORDER[0],
  'introduction to culture': STAGE_ORDER[0],
  cloning: STAGE_ORDER[1],
  propagation: STAGE_ORDER[1],
  adaptation: STAGE_ORDER[2],
  acclimatization: STAGE_ORDER[2],
  greenhouse: STAGE_ORDER[3],
  hardening: STAGE_ORDER[4],
  planting: STAGE_ORDER[5],
  transplanting: STAGE_ORDER[5]
};
const STAGE_KEYS = new Map([
  ...STAGE_ORDER.map((stage) => [normalizeText(stage), stage]),
  ...Object.entries(STAGE_ALIASES).map(([alias, stage]) => [normalizeText(alias), stage])
]);

function safeReportId(value) {
  const input = String(value || '').trim();
  const cleaned = input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'report';
}

function buildImportFallbackReportId(rawReport, originalName) {
  const fileStem = path.parse(String(originalName || '')).name;
  const baseId = safeReportId(fileStem);
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(rawReport || {}))
    .digest('hex')
    .slice(0, 8);

  return baseId === 'report' ? `report-${fingerprint}` : `${baseId}-${fingerprint}`;
}

function createHttpError(message, userMessage, statusCode = 400) {
  const error = new Error(message);
  error.userMessage = userMessage;
  error.statusCode = statusCode;
  return error;
}

function warnSkippedReport(reportId, context, error) {
  const reason = error && error.message ? error.message : String(error || 'unknown error');
  console.warn(`[reportStore] Skipping invalid report "${reportId}" during ${context}: ${reason}`);
}

function warnInvalidSummary(reportId, error) {
  const reason = error && error.message ? error.message : String(error || 'unknown error');
  console.warn(`[reportStore] Ignoring invalid summary for "${reportId}": ${reason}`);
}

function normalizeImportError(error) {
  const targetError = error || new Error('Report import failed.');
  const message = targetError && targetError.message ? String(targetError.message) : '';

  if (targetError instanceof SyntaxError) {
    targetError.userMessage = 'Файл report.json содержит невалидный JSON.';
    targetError.statusCode = 400;
    targetError.internalCode = 'INVALID_REPORT_JSON';
    return targetError;
  }

  if (
    /zip|central directory|invalid signature|end of central directory|FILE_ENDED|FILE_NOT_FOUND|unexpected end/i.test(message)
  ) {
    targetError.userMessage = 'ZIP-архив поврежден или имеет неверный формат.';
    targetError.statusCode = 400;
    targetError.internalCode = 'INVALID_ZIP_ARCHIVE';
    return targetError;
  }

  if (targetError.userMessage) {
    return targetError;
  }

  targetError.userMessage = 'Не удалось обработать загруженный архив.';
  targetError.statusCode = targetError.statusCode || 400;
  targetError.internalCode = targetError.internalCode || 'REPORT_IMPORT_FAILED';
  return targetError;
}

function createHiddenReportsStateError(error) {
  const stateError = createHttpError(
    error && error.message ? error.message : 'Invalid hidden reports state.',
    'Не удалось прочитать служебное состояние скрытых отчетов.',
    500
  );
  stateError.internalCode = 'INVALID_HIDDEN_REPORTS_STATE';
  return stateError;
}

function parseHiddenReportIdsState(content) {
  const parsed = JSON.parse(String(content || '').replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed)) {
    throw new Error('Hidden reports state must be an array.');
  }
  return new Set(parsed.map((value) => safeReportId(value)).filter(Boolean));
}

function ensureInside(basePath, targetPath) {
  const resolvedBase = path.resolve(basePath) + path.sep;
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    const error = new Error('Detected unsafe path in archive.');
    error.userMessage = 'Архив содержит небезопасный путь к файлу.';
    error.statusCode = 400;
    throw error;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function assertValidIsoLikeDate(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  const timestamp = Date.parse(String(value));
  if (Number.isNaN(timestamp)) {
    throw createHttpError(
      `Invalid ${fieldName}: ${value}`,
      'Отчет содержит некорректную дату.',
      400
    );
  }
}

function assertObjectRecord(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(
      `Invalid ${fieldName} shape.`,
      'Отчет содержит некорректную структуру данных.',
      400
    );
  }
}

function normalizeArchiveEntryPath(rawPath) {
  const raw = String(rawPath || '').replace(/\0/g, '').trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:/.test(raw) || raw.includes('://')) {
    throw createHttpError(
      `Unsafe archive path: ${raw}`,
      'Архив содержит небезопасный путь к файлу.',
      400
    );
  }

  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);

  if (parts.some((part) => part === '.' || part === '..')) {
    throw createHttpError(
      `Path traversal attempt: ${raw}`,
      'Архив содержит небезопасный путь к файлу.',
      400
    );
  }

  const normalizedPath = parts.join('/');
  if (normalizedPath.length > ZIP_LIMITS.maxPathLength) {
    throw createHttpError(
      `Archive path too long: ${normalizedPath}`,
      'Архив содержит слишком длинный путь к файлу.',
      400
    );
  }

  const depth = Math.max(parts.length - 1, 0);
  if (depth > ZIP_LIMITS.maxPathDepth) {
    throw createHttpError(
      `Archive path too deep: ${normalizedPath}`,
      'Архив содержит слишком глубокую вложенность каталогов.',
      400
    );
  }

  return normalizedPath;
}

async function readHiddenReportIds() {
  try {
    const content = await fs.readFile(HIDDEN_REPORTS_PATH, 'utf8');
    return parseHiddenReportIdsState(content);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return new Set();
    }
    throw createHiddenReportsStateError(error);
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
  }
  return '';
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function firstVisibleString(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (isVisiblePlantPart(value)) {
      return String(value).trim();
    }
  }
  return '';
}

function pickExtraFields(source, reservedKeys) {
  const extras = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!reservedKeys.has(key) && value !== undefined) {
      extras[key] = value;
    }
  }
  return extras;
}

function flattenText(value, output) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, output);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenText(item, output);
  }
}

function _legacyNormalizeEvent(event, index, options = {}) {
  const reserved = new Set(['eventId', 'createdBy', 'date', 'createdAt', 'type', 'eventType', 'author', 'user', 'userName', 'comment', 'message', 'problem', 'risk', 'quantity', 'count', 'photos', 'photoPath', 'photoPaths', 'images']);
  const date = firstString(event, ['date', 'createdAt', 'time', 'timestamp']);
  const type = firstString(event, ['type', 'eventType', 'name']) || `Event ${index + 1}`;
  const author = firstString(event, ['author', 'user', 'userName']);
  const createdBy = firstString(event, ['createdBy']) || author || options.fallbackCreatedBy || 'Неизвестно';
  const eventId = firstString(event, ['eventId']) || `${options.reportId || 'report'}-${options.cardIndex || 0}-${index + 1}`;
  const comment = firstString(event, ['comment', 'message', 'text', 'details']);
  const problem = firstString(event, ['problem']);
  const risk = firstString(event, ['risk']);
  const quantity = firstString(event, ['quantity', 'count']);
  return {
    eventId,
    createdBy,
    date,
    type,
    author,
    comment,
    problem,
    risk,
    quantity,
    photos: normalizePhotoPaths(event || {}, ''),
    extraFields: pickExtraFields(event || {}, reserved)
  };
}

function _legacyNormalizeCard(card, index, reportId, reportAuthor = '') {
  const reserved = new Set([
    'code',
    'partyCode',
    'culture',
    'variety',
    'sort',
    'stage',
    'status',
    'initialCount',
    'currentCount',
    'location',
    'place',
    'events',
    'photos',
    'photoPath',
    'photoPaths',
    'images',
    'problem',
    'risk',
    'date',
    'author'
  ]);

  const fallbackCreatedBy = firstString(card, ['author', 'user', 'userName']) || reportAuthor;
  const events = toArray(card.events).map((event, eventIndex) => _legacyNormalizeEvent(event, eventIndex, {
    reportId,
    cardIndex: index + 1,
    fallbackCreatedBy
  }));
  const photos = normalizePhotoPaths(card, reportId);
  const code = firstString(card, ['code', 'partyCode', 'partyId', 'party_id', 'id']) || `card-${index + 1}`;
  const culture = firstVisibleString(card, ['culture', 'crop', 'plant']);
  const variety = firstVisibleString(card, ['variety', 'cultivar']);
  const sort = firstVisibleString(card, ['sort', 'grade']);
  const stage = canonicalizeStage(firstString(card, ['stage', 'phase']));
  const status = firstString(card, ['status', 'partyStatus']);
  const initialCount = firstString(card, ['initialCount', 'startCount', 'plannedCount']);
  const currentCount = firstString(card, ['currentCount', 'remainingCount', 'balance']);
  const location = firstString(card, ['location', 'place', 'position']);
  const problem = firstString(card, ['problem']);
  const risk = firstString(card, ['risk']);
  const date = firstString(card, ['date', 'createdAt', 'time']);
  const author = firstString(card, ['author', 'user', 'userName']) || reportAuthor;

  const searchableText = [];
  flattenText(card, searchableText);

  return {
    index,
    code,
    culture,
    variety,
    sort,
    stage,
    status,
    initialCount,
    currentCount,
    location,
    problem,
    risk,
    date,
    author,
    events,
    photos,
    extraFields: pickExtraFields(card || {}, reserved),
    searchText: searchableText.join(' ').toLowerCase()
  };
}

function _legacyDeriveSummary(rawSummary, cards) {
  const summary = {
    cardsCount: cards.length,
    eventsCount: 0,
    photosCount: 0,
    problemsCount: 0,
    activeCount: 0,
    soldCount: 0
  };

  for (const card of cards) {
    summary.eventsCount += card.events.length;
    summary.photosCount += countUniqueCardPhotos(card);
    if (card.problem || card.risk || card.events.some((event) => event.problem || event.risk)) {
      summary.problemsCount += 1;
    }

    const status = String(card.status || '').toLowerCase();
    if (status.includes('active')) summary.activeCount += 1;
    if (status.includes('sold')) summary.soldCount += 1;
  }

  if (rawSummary && typeof rawSummary === 'object') {
    for (const key of Object.keys(summary)) {
      if (key === 'photosCount') continue;
      const value = toFiniteSummaryNumber(rawSummary[key]);
      if (value !== null) {
        summary[key] = value;
      }
    }
  }

  return summary;
}

function getStorageUrl(reportId, relativePath) {
  const cleanId = safeReportId(reportId);
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const cleanPath = normalizedPath.replace(/^photos\//, '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/reports/${encodeURIComponent(cleanId)}/photos/${cleanPath}`;
}

function formatDateValue(value) {
  if (!value) return 'Неизвестно';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveReportAuthor(report = {}) {
  const user = report && report.user ? report.user : {};
  const displayName = String(user.displayName || '').trim();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const author = String(report.author || '').trim();
  const userName = String(report.userName || '').trim();
  return displayName || fullName || author || userName || 'Автор не указан';
}

function parseReport(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const error = new Error('report.json must be an object.');
    error.userMessage = 'В report.json должен быть JSON-объект.';
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(raw.cards)) {
    throw createHttpError(
      'report.json cards must be an array.',
      'Отчет содержит некорректную структуру: cards должен быть массивом.',
      400
    );
  }
  if (raw.user !== undefined && raw.user !== null) {
    assertObjectRecord(raw.user, 'user');
  }
  if (raw.summary !== undefined && raw.summary !== null) {
    assertObjectRecord(raw.summary, 'summary');
  }
  assertValidIsoLikeDate(raw.createdAt, 'createdAt');

  const reportId = safeReportId(raw.reportId || options.fallbackId || 'report');
  const reportAuthor = resolveReportAuthor(raw);
  const eventFallbackAuthor = reportAuthor === 'Автор не указан' ? '' : reportAuthor;
  const cards = raw.cards.map((card, index) => {
    assertObjectRecord(card, `cards[${index}]`);
    if (card.events !== undefined && !Array.isArray(card.events)) {
      throw createHttpError(
        `cards[${index}].events must be an array.`,
        'Отчет содержит некорректную структуру: events должен быть массивом.',
        400
      );
    }
    if (!firstString(card, ['cardId', 'code', 'partyCode', 'partyId', 'party_id', 'id'])) {
      throw createHttpError(
        `cards[${index}] is missing card identifier.`,
        'Отчет содержит карточку без идентификатора.',
        400
      );
    }
    assertValidIsoLikeDate(firstString(card, ['createdAt', 'date']), `cards[${index}].createdAt`);
    assertValidIsoLikeDate(firstString(card, ['updatedAt']), `cards[${index}].updatedAt`);

    for (const [eventIndex, event] of toArray(card.events).entries()) {
      assertObjectRecord(event, `cards[${index}].events[${eventIndex}]`);
      assertValidIsoLikeDate(firstString(event, ['createdAt', 'timestamp', 'date']), `cards[${index}].events[${eventIndex}]`);
    }

    return normalizeCard(card, index, reportId, {
      reportAuthor: eventFallbackAuthor,
      reportUserId: firstString(raw.user || {}, ['userId'])
    });
  });
  const seenEventIds = new Map();

  for (const card of cards) {
    card.events = card.events.map((event, eventIndex) => {
      const rawId = typeof event.eventId === 'string' && event.eventId.trim()
        ? event.eventId.trim()
        : `${reportId}-${card.index + 1}-${eventIndex + 1}`;
      const previousCount = seenEventIds.get(rawId) || 0;
      const eventId = previousCount === 0 ? rawId : `${rawId}-${previousCount + 1}`;
      seenEventIds.set(rawId, previousCount + 1);
      return {
        ...event,
        eventId
      };
    });
  }

  return {
    reportId,
    createdAt: raw.createdAt || new Date().toISOString(),
    deviceId: firstString(raw, ['deviceId']),
    author: firstString(raw, ['author']),
    userName: firstString(raw, ['userName']),
    user: {
      userId: firstString(raw.user || {}, ['userId']),
      firstName: firstString(raw.user || {}, ['firstName']),
      lastName: firstString(raw.user || {}, ['lastName']),
      displayName: firstString(raw.user || {}, ['displayName']) || [firstString(raw.user || {}, ['firstName']), firstString(raw.user || {}, ['lastName'])].filter(Boolean).join(' ').trim(),
      role: firstString(raw.user || {}, ['role'])
    },
    testLocation: firstString(raw, ['testLocation']),
    summary: deriveSummary(raw.summary, cards),
    cards,
    raw
  };
}

function normalizeMergeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length) {
        return value;
      }
      continue;
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length) {
        return value;
      }
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function mergeUniqueStrings(left = [], right = []) {
  const values = [];
  const seen = new Set();

  for (const value of [...toArray(left), ...toArray(right)]) {
    const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(value);
  }

  return values;
}

function mergeUniqueValues(left = [], right = []) {
  const values = [];
  const seen = new Set();

  for (const value of [...toArray(left), ...toArray(right)]) {
    const key = buildMergeValueKey(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(typeof value === 'string' ? value.trim() : value);
  }

  return values;
}

function buildMergeValueKey(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? `string:${text.toLowerCase()}` : '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `number:${value}`;
  }
  if (typeof value === 'boolean') {
    return `boolean:${value}`;
  }
  if (value && typeof value === 'object') {
    const alias = firstString(value, ['uri', 'path', 'file', 'name', 'photoPath', 'photoUri']);
    if (alias) {
      return `photo:${alias.toLowerCase()}`;
    }
    return `object:${JSON.stringify(value)}`;
  }
  return '';
}

function mergeShallowObjects(left, right) {
  return {
    ...(left && typeof left === 'object' ? left : {}),
    ...(right && typeof right === 'object' ? right : {})
  };
}

function mergeObjectWithPreferredValues(existing, incoming, keys = []) {
  const merged = mergeShallowObjects(existing, incoming);

  for (const key of keys) {
    const preferred = firstNonEmptyValue(
      incoming && incoming[key],
      existing && existing[key]
    );

    if (preferred !== undefined) {
      merged[key] = preferred;
    }
  }

  return merged;
}

function mergeObjectWithPreferredEntries(existing, incoming) {
  const merged = mergeShallowObjects(existing, incoming);
  const keys = new Set([
    ...Object.keys(existing && typeof existing === 'object' ? existing : {}),
    ...Object.keys(incoming && typeof incoming === 'object' ? incoming : {})
  ]);

  for (const key of keys) {
    if (isPlainObjectValue(existing && existing[key]) && isPlainObjectValue(incoming && incoming[key])) {
      merged[key] = mergeObjectWithPreferredEntries(existing[key], incoming[key]);
      continue;
    }

    const preferred = firstNonEmptyValue(
      incoming && incoming[key],
      existing && existing[key]
    );

    if (preferred !== undefined) {
      merged[key] = preferred;
    }
  }

  return merged;
}

function isPlainObjectValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveExtraFieldsSource(parsedEntity, rawEntity) {
  if (parsedEntity && typeof parsedEntity.extraFields === 'object' && !Array.isArray(parsedEntity.extraFields)) {
    return parsedEntity.extraFields;
  }
  if (rawEntity && typeof rawEntity.extraFields === 'object' && !Array.isArray(rawEntity.extraFields)) {
    return rawEntity.extraFields;
  }
  return null;
}

function toFiniteSummaryNumber(value) {
  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalizeStage(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return STAGE_KEYS.get(normalizeText(text)) || text;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isUnknownAuthor(value) {
  return ['unknown', 'неизвестно', 'local-user'].includes(normalizeText(value));
}

function mergeCardRaw(existingCardRaw, incomingCardRaw, existingParsedCard, incomingParsedCard) {
  const merged = {
    ...(existingCardRaw && typeof existingCardRaw === 'object' ? existingCardRaw : {})
  };

  const scalarKeys = [
    'cardId',
    'code',
    'partyCode',
    'partyId',
    'party_id',
    'id',
    'cultureName',
    'speciesName',
    'varietyName',
    'culture',
    'crop',
    'plant',
    'sort',
    'grade',
    'stage',
    'phase',
    'batchStatus',
    'status',
    'partyStatus',
    'sterilityStatus',
    'quantity',
    'initialCount',
    'startCount',
    'plannedCount',
    'currentQuantity',
    'currentCount',
    'remainingCount',
    'balance',
    'locationDescription',
    'location',
    'place',
    'position',
    'problem',
    'problemType',
    'risk',
    'riskLevel',
    'activeProblemQuantity',
    'healthyQuantity',
    'healthStatus',
    'isolationStatus',
    'unisolatedProblemQuantity',
    'originType',
    'parentCardId',
    'parentCode',
    'sourceEventId',
    'sourceProblemEventId',
    'childCardId',
    'childCode',
    'generation',
    'propagatedAt',
    'propagationMethod',
    'createdAt',
    'updatedAt',
    'date',
    'author',
    'user',
    'userName',
    'photoPath',
    'photoUri',
    'startPhotoUri'
  ];

  for (const key of scalarKeys) {
    const incomingValue = incomingCardRaw && incomingCardRaw[key];
    const existingValue = merged[key];
    const preferred = firstNonEmptyValue(incomingValue, existingValue);
    if (preferred !== undefined) {
      merged[key] = preferred;
    }
  }

  merged.photos = mergeUniqueValues(existingCardRaw && existingCardRaw.photos, incomingCardRaw && incomingCardRaw.photos);
  merged.photoFiles = mergeUniqueStrings(existingCardRaw && existingCardRaw.photoFiles, incomingCardRaw && incomingCardRaw.photoFiles);
  merged.photoPath = firstNonEmptyValue(
    existingCardRaw && existingCardRaw.photoPath,
    incomingCardRaw && incomingCardRaw.photoPath
  );
  merged.photoPaths = mergeUniqueStrings(existingCardRaw && existingCardRaw.photoPaths, incomingCardRaw && incomingCardRaw.photoPaths);
  merged.photoPaths = mergeUniqueStrings(
    merged.photoPaths,
    [existingCardRaw && existingCardRaw.photoPath, incomingCardRaw && incomingCardRaw.photoPath].filter(Boolean)
  );
  merged.images = mergeUniqueValues(existingCardRaw && existingCardRaw.images, incomingCardRaw && incomingCardRaw.images);
  merged.photoUri = firstNonEmptyValue(
    existingCardRaw && existingCardRaw.photoUri,
    incomingCardRaw && incomingCardRaw.photoUri
  );
  merged.photoUris = mergeUniqueStrings(existingCardRaw && existingCardRaw.photoUris, incomingCardRaw && incomingCardRaw.photoUris);
  merged.photoUris = mergeUniqueStrings(
    merged.photoUris,
    [existingCardRaw && existingCardRaw.photoUri, incomingCardRaw && incomingCardRaw.photoUri].filter(Boolean)
  );
  merged.startPhotoUri = firstNonEmptyValue(
    existingCardRaw && existingCardRaw.startPhotoUri,
    incomingCardRaw && incomingCardRaw.startPhotoUri
  );
  merged.startPhotoUris = mergeUniqueStrings(existingCardRaw && existingCardRaw.startPhotoUris, incomingCardRaw && incomingCardRaw.startPhotoUris);
  merged.startPhotoUris = mergeUniqueStrings(
    merged.startPhotoUris,
    [existingCardRaw && existingCardRaw.startPhotoUri, incomingCardRaw && incomingCardRaw.startPhotoUri].filter(Boolean)
  );

  const existingEvents = toArray(existingCardRaw && existingCardRaw.events);
  const incomingEvents = toArray(incomingCardRaw && incomingCardRaw.events);
  const existingParsedEvents = toArray(existingParsedCard && existingParsedCard.events);
  const incomingParsedEvents = toArray(incomingParsedCard && incomingParsedCard.events);

  const eventIndexByKey = new Map();
  const mergedEvents = [];

  existingEvents.forEach((event, index) => {
    const parsedEvent = existingParsedEvents[index] || {};
    const eventKey = normalizeMergeKey(firstNonEmptyValue(parsedEvent.eventId, event && event.eventId, `${index + 1}`));
    if (!eventIndexByKey.has(eventKey)) {
      eventIndexByKey.set(eventKey, mergedEvents.length);
      mergedEvents.push(event);
    }
  });

  incomingEvents.forEach((event, index) => {
    const parsedEvent = incomingParsedEvents[index] || {};
    const eventKey = normalizeMergeKey(firstNonEmptyValue(parsedEvent.eventId, event && event.eventId, `${index + 1}`));
    const existingIndex = eventIndexByKey.get(eventKey);
    if (existingIndex !== undefined) {
      const existingEvent = mergedEvents[existingIndex];
      mergedEvents[existingIndex] = mergeObjectWithPreferredValues(existingEvent, event, [
        'eventId',
        'createdBy',
        'date',
        'createdAt',
        'time',
        'timestamp',
        'type',
        'eventType',
        'title',
        'stage',
        'author',
        'user',
        'userName',
        'comment',
        'message',
        'text',
        'details',
        'problem',
        'problemType',
        'risk',
        'riskLevel',
        'quantity',
        'count',
        'previousQuantity',
        'currentQuantity',
        'parentCardId',
        'parentCode',
        'childCardId',
        'childCode',
        'sourceEventId',
        'sourceProblemEventId',
        'generation',
        'propagationMethod',
        'healthStatus',
        'isolationStatus',
        'activeProblemQuantity',
        'unisolatedProblemQuantity'
      ]);
      mergedEvents[existingIndex].photos = mergeUniqueValues(existingEvent && existingEvent.photos, event && event.photos);
      mergedEvents[existingIndex].photoFiles = mergeUniqueStrings(existingEvent && existingEvent.photoFiles, event && event.photoFiles);
      mergedEvents[existingIndex].photoPath = firstNonEmptyValue(
        existingEvent && existingEvent.photoPath,
        event && event.photoPath
      );
      mergedEvents[existingIndex].photoPaths = mergeUniqueStrings(existingEvent && existingEvent.photoPaths, event && event.photoPaths);
      mergedEvents[existingIndex].photoPaths = mergeUniqueStrings(
        mergedEvents[existingIndex].photoPaths,
        [existingEvent && existingEvent.photoPath, event && event.photoPath].filter(Boolean)
      );
      mergedEvents[existingIndex].images = mergeUniqueValues(existingEvent && existingEvent.images, event && event.images);
      mergedEvents[existingIndex].photoUri = firstNonEmptyValue(
        existingEvent && existingEvent.photoUri,
        event && event.photoUri
      );
      mergedEvents[existingIndex].photoUris = mergeUniqueStrings(existingEvent && existingEvent.photoUris, event && event.photoUris);
      mergedEvents[existingIndex].photoUris = mergeUniqueStrings(
        mergedEvents[existingIndex].photoUris,
        [existingEvent && existingEvent.photoUri, event && event.photoUri].filter(Boolean)
      );
      const existingExtraFields = resolveExtraFieldsSource(existingParsedEvents[existingIndex], existingEvent);
      const incomingExtraFields = resolveExtraFieldsSource(parsedEvent, event);
      if (existingExtraFields) {
        mergedEvents[existingIndex].extraFields = mergeObjectWithPreferredEntries(existingExtraFields, incomingExtraFields);
      } else if (incomingExtraFields) {
        mergedEvents[existingIndex].extraFields = mergeObjectWithPreferredEntries({}, incomingExtraFields);
      }
      return;
    }

    eventIndexByKey.set(eventKey, mergedEvents.length);
    mergedEvents.push(event);
  });

  merged.events = mergedEvents;
  const existingCardExtraFields = resolveExtraFieldsSource(existingParsedCard, existingCardRaw);
  const incomingCardExtraFields = resolveExtraFieldsSource(incomingParsedCard, incomingCardRaw);
  if (existingCardExtraFields) {
    merged.extraFields = mergeObjectWithPreferredEntries(existingCardExtraFields, incomingCardExtraFields);
  } else if (incomingCardExtraFields) {
    merged.extraFields = mergeObjectWithPreferredEntries({}, incomingCardExtraFields);
  }

  return merged;
}

function mergeReportRaw(existingParsed, incomingParsed, finalReportId) {
  const existingRaw = existingParsed ? existingParsed.raw : null;
  const incomingRaw = incomingParsed ? incomingParsed.raw : null;
  const existingCards = toArray(existingRaw && existingRaw.cards);
  const incomingCards = toArray(incomingRaw && incomingRaw.cards);
  const existingParsedCards = toArray(existingParsed && existingParsed.cards);
  const incomingParsedCards = toArray(incomingParsed && incomingParsed.cards);

  const mergedCards = existingCards.map((card) => ({
    ...(card && typeof card === 'object' ? card : {})
  }));

  const cardIndexByKey = new Map();

  existingCards.forEach((card, index) => {
    const parsedCard = existingParsedCards[index] || {};
    const cardKey = normalizeMergeKey(firstNonEmptyValue(parsedCard.cardId, parsedCard.code, card && card.cardId, card && card.code, `card-${index + 1}`));
    if (!cardIndexByKey.has(cardKey)) {
      cardIndexByKey.set(cardKey, index);
    }
  });

  incomingCards.forEach((card, index) => {
    const parsedCard = incomingParsedCards[index] || {};
    const cardKey = normalizeMergeKey(firstNonEmptyValue(parsedCard.cardId, parsedCard.code, card && card.cardId, card && card.code, `card-${index + 1}`));
    const existingIndex = cardIndexByKey.get(cardKey);

    if (existingIndex !== undefined) {
      mergedCards[existingIndex] = mergeCardRaw(
        mergedCards[existingIndex],
        card,
        existingParsedCards[existingIndex] || {},
        parsedCard
      );
      return;
    }

    cardIndexByKey.set(cardKey, mergedCards.length);
    mergedCards.push({
      ...(card && typeof card === 'object' ? card : {})
    });
  });

  const mergedRaw = {
    ...(existingRaw && typeof existingRaw === 'object' ? existingRaw : {}),
    ...(incomingRaw && typeof incomingRaw === 'object' ? incomingRaw : {})
  };

  mergedRaw.reportId = finalReportId;
  mergedRaw.createdAt = firstNonEmptyValue(existingRaw && existingRaw.createdAt, incomingRaw && incomingRaw.createdAt, new Date().toISOString());
  mergedRaw.deviceId = firstNonEmptyValue(existingRaw && existingRaw.deviceId, incomingRaw && incomingRaw.deviceId) || '';
  mergedRaw.testLocation = firstNonEmptyValue(existingRaw && existingRaw.testLocation, incomingRaw && incomingRaw.testLocation) || '';
  mergedRaw.author = firstNonEmptyValue(existingRaw && existingRaw.author, incomingRaw && incomingRaw.author) || '';
  mergedRaw.userName = firstNonEmptyValue(existingRaw && existingRaw.userName, incomingRaw && incomingRaw.userName) || '';
  mergedRaw.user = mergeObjectWithPreferredValues(
    existingRaw && existingRaw.user,
    incomingRaw && incomingRaw.user,
    ['userId', 'firstName', 'lastName', 'displayName', 'role']
  );
  mergedRaw.summary = mergeShallowObjects(existingRaw && existingRaw.summary, incomingRaw && incomingRaw.summary);
  mergedRaw.cards = mergedCards;

  return mergedRaw;
}

function buildReportFingerprint(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const normalizeFingerprintValue = (value) => {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizeFingerprintValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = normalizeFingerprintValue(value[key]);
          return result;
        }, {});
    }
    return '';
  };

  const cards = toArray(parsed.cards).map((card) => ({
    cardId: card && card.cardId ? String(card.cardId).trim().toLowerCase() : '',
    code: card && card.code ? String(card.code).trim().toLowerCase() : '',
    culture: card && card.culture ? String(card.culture).trim().toLowerCase() : '',
    variety: card && card.variety ? String(card.variety).trim().toLowerCase() : '',
    sort: card && card.sort ? String(card.sort).trim().toLowerCase() : '',
    stage: card && card.stage ? String(card.stage).trim().toLowerCase() : '',
    status: card && card.status ? String(card.status).trim().toLowerCase() : '',
    sterilityStatus: card && card.sterilityStatus ? String(card.sterilityStatus).trim().toLowerCase() : '',
    quantity: card && card.initialCount ? String(card.initialCount).trim().toLowerCase() : '',
    currentCount: card && card.currentCount ? String(card.currentCount).trim().toLowerCase() : '',
    location: card && card.location ? String(card.location).trim().toLowerCase() : '',
    author: card && card.author ? String(card.author).trim().toLowerCase() : '',
    problem: card && card.problem ? String(card.problem).trim().toLowerCase() : '',
    problemType: card && card.problemType ? String(card.problemType).trim().toLowerCase() : '',
    risk: card && card.risk ? String(card.risk).trim().toLowerCase() : '',
    riskLevel: card && card.riskLevel ? String(card.riskLevel).trim().toLowerCase() : '',
    activeProblemQuantity: card && card.activeProblemQuantity ? String(card.activeProblemQuantity).trim().toLowerCase() : '',
    healthyQuantity: card && card.healthyQuantity ? String(card.healthyQuantity).trim().toLowerCase() : '',
    healthStatus: card && card.healthStatus ? String(card.healthStatus).trim().toLowerCase() : '',
    isolationStatus: card && card.isolationStatus ? String(card.isolationStatus).trim().toLowerCase() : '',
    unisolatedProblemQuantity: card && card.unisolatedProblemQuantity ? String(card.unisolatedProblemQuantity).trim().toLowerCase() : '',
    originType: card && card.originType ? String(card.originType).trim().toLowerCase() : '',
    parentCardId: card && card.parentCardId ? String(card.parentCardId).trim().toLowerCase() : '',
    parentCode: card && card.parentCode ? String(card.parentCode).trim().toLowerCase() : '',
    sourceEventId: card && card.sourceEventId ? String(card.sourceEventId).trim().toLowerCase() : '',
    sourceProblemEventId: card && card.sourceProblemEventId ? String(card.sourceProblemEventId).trim().toLowerCase() : '',
    childCardId: card && card.childCardId ? String(card.childCardId).trim().toLowerCase() : '',
    childCode: card && card.childCode ? String(card.childCode).trim().toLowerCase() : '',
    generation: card && card.generation ? String(card.generation).trim().toLowerCase() : '',
    propagatedAt: card && card.propagatedAt ? String(card.propagatedAt).trim().toLowerCase() : '',
    propagationMethod: card && card.propagationMethod ? String(card.propagationMethod).trim().toLowerCase() : '',
    createdAt: card && card.createdAt ? String(card.createdAt).trim().toLowerCase() : '',
    updatedAt: card && card.updatedAt ? String(card.updatedAt).trim().toLowerCase() : '',
    photos: normalizeFingerprintValue(card && card.photos),
    extraFields: normalizeFingerprintValue(card && card.extraFields),
    events: toArray(card && card.events).map((event) => ({
      eventId: event && event.eventId ? String(event.eventId).trim().toLowerCase() : '',
      createdBy: event && event.createdBy ? String(event.createdBy).trim().toLowerCase() : '',
      date: event && event.date ? String(event.date).trim().toLowerCase() : '',
      createdAt: event && event.createdAt ? String(event.createdAt).trim().toLowerCase() : '',
      time: event && event.time ? String(event.time).trim().toLowerCase() : '',
      timestamp: event && event.timestamp ? String(event.timestamp).trim().toLowerCase() : '',
      type: event && event.type ? String(event.type).trim().toLowerCase() : '',
      title: event && event.title ? String(event.title).trim().toLowerCase() : '',
      stage: event && event.stage ? String(event.stage).trim().toLowerCase() : '',
      author: event && event.author ? String(event.author).trim().toLowerCase() : '',
      comment: event && event.comment ? String(event.comment).trim().toLowerCase() : '',
      problem: event && event.problem ? String(event.problem).trim().toLowerCase() : '',
      problemType: event && event.problemType ? String(event.problemType).trim().toLowerCase() : '',
      risk: event && event.risk ? String(event.risk).trim().toLowerCase() : '',
      riskLevel: event && event.riskLevel ? String(event.riskLevel).trim().toLowerCase() : '',
      quantity: event && event.quantity ? String(event.quantity).trim().toLowerCase() : '',
      previousQuantity: event && event.previousQuantity ? String(event.previousQuantity).trim().toLowerCase() : '',
      currentQuantity: event && event.currentQuantity ? String(event.currentQuantity).trim().toLowerCase() : '',
      parentCardId: event && event.parentCardId ? String(event.parentCardId).trim().toLowerCase() : '',
      parentCode: event && event.parentCode ? String(event.parentCode).trim().toLowerCase() : '',
      childCardId: event && event.childCardId ? String(event.childCardId).trim().toLowerCase() : '',
      childCode: event && event.childCode ? String(event.childCode).trim().toLowerCase() : '',
      sourceEventId: event && event.sourceEventId ? String(event.sourceEventId).trim().toLowerCase() : '',
      sourceProblemEventId: event && event.sourceProblemEventId ? String(event.sourceProblemEventId).trim().toLowerCase() : '',
      generation: event && event.generation ? String(event.generation).trim().toLowerCase() : '',
      propagationMethod: event && event.propagationMethod ? String(event.propagationMethod).trim().toLowerCase() : '',
      healthStatus: event && event.healthStatus ? String(event.healthStatus).trim().toLowerCase() : '',
      isolationStatus: event && event.isolationStatus ? String(event.isolationStatus).trim().toLowerCase() : '',
      activeProblemQuantity: event && event.activeProblemQuantity ? String(event.activeProblemQuantity).trim().toLowerCase() : '',
      unisolatedProblemQuantity: event && event.unisolatedProblemQuantity ? String(event.unisolatedProblemQuantity).trim().toLowerCase() : '',
      photos: normalizeFingerprintValue(event && event.photos),
      extraFields: normalizeFingerprintValue(event && event.extraFields)
    }))
  }));

  return JSON.stringify({
    reportId: parsed.reportId ? String(parsed.reportId).trim().toLowerCase() : '',
    createdAt: parsed.createdAt ? String(parsed.createdAt).trim() : '',
    deviceId: parsed.deviceId ? String(parsed.deviceId).trim().toLowerCase() : '',
    user: {
      userId: parsed.user && parsed.user.userId ? String(parsed.user.userId).trim().toLowerCase() : '',
      firstName: parsed.user && parsed.user.firstName ? String(parsed.user.firstName).trim().toLowerCase() : '',
      lastName: parsed.user && parsed.user.lastName ? String(parsed.user.lastName).trim().toLowerCase() : '',
      displayName: parsed.user && parsed.user.displayName ? String(parsed.user.displayName).trim().toLowerCase() : '',
      role: parsed.user && parsed.user.role ? String(parsed.user.role).trim().toLowerCase() : ''
    },
    author: parsed.author ? String(parsed.author).trim().toLowerCase() : '',
    userName: parsed.userName ? String(parsed.userName).trim().toLowerCase() : '',
    testLocation: parsed.testLocation ? String(parsed.testLocation).trim().toLowerCase() : '',
    cards
  });
}

async function loadExistingReportFingerprints() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  const fingerprints = new Map();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const reportId = safeReportId(entry.name);
    const reportJsonPath = path.join(REPORTS_DIR, reportId, 'report.json');
    if (!(await pathExists(reportJsonPath))) {
      continue;
    }

    try {
      const raw = await readJsonFile(reportJsonPath);
      const parsed = parseReport(raw, { fallbackId: reportId });
      const fingerprint = buildReportFingerprint(parsed);
      if (!fingerprints.has(fingerprint)) {
        fingerprints.set(fingerprint, {
          reportId: parsed.reportId,
          reportDir: path.join(REPORTS_DIR, reportId),
          parsed
        });
      }
    } catch (error) {
      warnSkippedReport(reportId, 'dedupe fingerprint loading', error);
      continue;
    }
  }

  return fingerprints;
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonFile(targetPath) {
  const content = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function readStoredSummary(reportId, summaryPath, displayCards, fallbackSummary) {
  if (!(await pathExists(summaryPath))) {
    return fallbackSummary;
  }

  try {
    const storedSummary = await readJsonFile(summaryPath);
    return deriveSummary(storedSummary, displayCards);
  } catch (error) {
    warnInvalidSummary(reportId, error);
    return fallbackSummary;
  }
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function cleanupDirectoryIfExists(targetPath) {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

async function replaceDirectoryAtomically(targetPath, stagedPath) {
  const backupPath = `${targetPath}.backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const targetExists = await pathExists(targetPath);

  try {
    if (targetExists) {
      await fs.rename(targetPath, backupPath);
    }
    await fs.rename(stagedPath, targetPath);
    await cleanupDirectoryIfExists(backupPath);
  } catch (error) {
    if (targetExists && (await pathExists(backupPath)) && !(await pathExists(targetPath))) {
      await fs.rename(backupPath, targetPath).catch(() => {});
    }
    throw normalizeImportError(error);
  } finally {
    await cleanupDirectoryIfExists(stagedPath);
  }
}

async function extractArchive(archivePath, targetDir) {
  const directory = await unzipper.Open.file(archivePath);
  let foundReport = false;
  let totalUncompressedBytes = 0;
  let extractedFilesCount = 0;
  const seenPaths = new Set();

  for (const file of directory.files) {
    const normalizedPath = normalizeArchiveEntryPath(file.path);
    if (!normalizedPath || normalizedPath.startsWith('__MACOSX/')) {
      continue;
    }

    const loweredPath = normalizedPath.toLowerCase();
    if (seenPaths.has(loweredPath)) {
      throw createHttpError(
        `Duplicate archive path: ${normalizedPath}`,
        'Архив содержит дублирующиеся пути файлов.',
        400
      );
    }
    seenPaths.add(loweredPath);

    const isPhotosRoot = normalizedPath === 'photos';
    const isReportJson = normalizedPath === 'report.json';
    const isPhotoFile = normalizedPath.startsWith('photos/');

    if (!isReportJson && !isPhotosRoot && !isPhotoFile) {
      const error = new Error(`Unexpected file in archive: ${normalizedPath}`);
      error.userMessage = 'Архив может содержать только report.json и папку photos/.';
      error.statusCode = 400;
      throw error;
    }

    if (!['Directory', 'File'].includes(file.type)) {
      throw createHttpError(
        `Unsupported archive entry type: ${file.type}`,
        'Архив содержит неподдерживаемый тип файла.',
        400
      );
    }

    if (file.type === 'File') {
      extractedFilesCount += 1;
      if (extractedFilesCount > ZIP_LIMITS.maxEntries) {
        throw createHttpError(
          `Archive contains too many files: ${extractedFilesCount}`,
          'Архив содержит слишком много файлов.',
          400
        );
      }

      const entrySize = Number(file.uncompressedSize || 0);
      if (!Number.isFinite(entrySize) || entrySize < 0) {
        throw createHttpError(
          `Archive entry has invalid size: ${normalizedPath}`,
          'Архив содержит файл с некорректным размером.',
          400
        );
      }
      if (entrySize > ZIP_LIMITS.maxEntryBytes) {
        throw createHttpError(
          `Archive entry too large: ${normalizedPath}`,
          'Архив содержит слишком большой файл.',
          400
        );
      }

      totalUncompressedBytes += entrySize;
      if (totalUncompressedBytes > ZIP_LIMITS.maxTotalBytes) {
        throw createHttpError(
          `Archive uncompressed size exceeded limit: ${totalUncompressedBytes}`,
          'Архив слишком большой после распаковки.',
          400
        );
      }

      if (loweredPath.endsWith('.zip')) {
        throw createHttpError(
          `Nested zip is not allowed: ${normalizedPath}`,
          'Архив не должен содержать вложенные ZIP-файлы.',
          400
        );
      }
    }

    const targetPath = path.join(targetDir, normalizedPath);
    ensureInside(targetDir, targetPath);

    if (file.type === 'Directory') {
      if (!isPhotosRoot && !isPhotoFile) {
        throw createHttpError(
          `Unexpected directory entry: ${normalizedPath}`,
          'Архив содержит неподдерживаемую структуру каталогов.',
          400
        );
      }
      await fs.mkdir(targetPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(file.stream(), fsSync.createWriteStream(targetPath));
    if (normalizedPath === 'report.json') {
      foundReport = true;
    }
  }

  if (!foundReport) {
    const error = new Error('Archive is missing report.json.');
    error.userMessage = 'Архив должен содержать report.json.';
    error.statusCode = 400;
    throw error;
  }
}

async function processUploadedReport(source, originalName) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-'));
  const archivePath = path.join(tempRoot, 'upload.zip');
  const extractedDir = path.join(tempRoot, 'extracted');

  try {
    if (typeof source === 'string') {
      await fs.copyFile(source, archivePath);
    } else {
      await fs.writeFile(archivePath, source);
    }
    await extractArchive(archivePath, extractedDir);

    const reportJsonPath = path.join(extractedDir, 'report.json');
    const rawReport = await readJsonFile(reportJsonPath);
    const parsed = parseReport(rawReport, { fallbackId: buildImportFallbackReportId(rawReport, originalName) });
    const incomingFingerprint = buildReportFingerprint(parsed);
    const existingReports = await loadExistingReportFingerprints();
    const matchedExisting = existingReports.get(incomingFingerprint) || null;
    const finalReportId = matchedExisting ? matchedExisting.reportId : parsed.reportId;
    const reportDir = matchedExisting ? matchedExisting.reportDir : path.join(REPORTS_DIR, finalReportId);
    const reportJsonTarget = path.join(reportDir, 'report.json');
    const hasExistingReport = await pathExists(reportJsonTarget);
    const mergedRaw = hasExistingReport
      ? mergeReportRaw(
        parseReport(await readJsonFile(reportJsonTarget), { fallbackId: finalReportId }),
        parsed,
        finalReportId
      )
      : {
        ...rawReport,
        reportId: finalReportId
      };
    const mergedParsed = parseReport(mergedRaw, { fallbackId: finalReportId });
    const storageRaw = {
      ...mergedRaw,
      cards: toArray(mergedRaw.cards).map((card, cardIndex) => {
        const normalizedCard = mergedParsed.cards[cardIndex] || { events: [] };
        const events = toArray(card.events).map((event, eventIndex) => ({
          ...event,
          eventId: normalizedCard.events[eventIndex] ? normalizedCard.events[eventIndex].eventId : `${finalReportId}-${cardIndex + 1}-${eventIndex + 1}`,
          createdBy: normalizedCard.events[eventIndex] ? normalizedCard.events[eventIndex].createdBy : firstString(event, ['createdBy']) || firstString(event, ['author', 'user', 'userName']) || 'Неизвестно'
        }));
        return {
          ...card,
          events
        };
      })
    };

    const stagedReportDir = path.join(tempRoot, 'staged-report');
    if (await pathExists(reportDir)) {
      await copyDirectory(reportDir, stagedReportDir);
    } else {
      await fs.mkdir(stagedReportDir, { recursive: true });
    }

    await writeJson(path.join(stagedReportDir, 'report.json'), storageRaw);
    await writeJson(path.join(stagedReportDir, 'summary.json'), mergedParsed.summary);

    const photosDir = path.join(extractedDir, 'photos');
    await fs.mkdir(path.join(stagedReportDir, 'photos'), { recursive: true });
    const hasPhotos = await pathExists(photosDir);
    if (hasPhotos) {
      await copyDirectory(photosDir, path.join(stagedReportDir, 'photos'));
    }

    await fs.copyFile(archivePath, path.join(stagedReportDir, 'original.zip'));
    await replaceDirectoryAtomically(reportDir, stagedReportDir);
    return finalReportId;
  } catch (error) {
    throw normalizeImportError(error);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function listReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  const hiddenReportIds = await readHiddenReportIds();
  const reports = [];
  const seenFingerprints = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reportId = safeReportId(entry.name);
    if (hiddenReportIds.has(reportId)) {
      continue;
    }
    const reportDir = path.join(REPORTS_DIR, reportId);
    const reportJsonPath = path.join(reportDir, 'report.json');
    const summaryJsonPath = path.join(reportDir, 'summary.json');

    if (!(await pathExists(reportJsonPath))) {
      continue;
    }

    try {
      const raw = await readJsonFile(reportJsonPath);
      const parsed = parseReport(raw, { fallbackId: reportId });
      const fingerprint = buildReportFingerprint(parsed);
      if (seenFingerprints.has(fingerprint)) {
        continue;
      }
      seenFingerprints.add(fingerprint);
      const reportDirPhotos = path.join(reportDir, 'photos');
      const photoFolderExists = await pathExists(reportDirPhotos);
      const availablePhotoPaths = photoFolderExists ? await collectPhotoPaths(reportDirPhotos, 'photos') : [];
      const availablePhotoSet = new Set(availablePhotoPaths);
      const photoIdentityByPath = await buildPhotoIdentityMap(reportDir, availablePhotoPaths);
      const displayCards = buildDisplayCards(parsed.cards, availablePhotoSet, photoIdentityByPath);
      const summary = await readStoredSummary(
        reportId,
        summaryJsonPath,
        displayCards,
        deriveSummary(parsed.summary, displayCards)
      );

      reports.push({
        reportId: parsed.reportId,
        createdAt: parsed.createdAt,
        displayCreatedAt: formatDateValue(parsed.createdAt),
        user: parsed.user,
        userName: parsed.userName,
        author: resolveReportAuthor(parsed),
        deviceId: parsed.deviceId,
        testLocation: parsed.testLocation,
        summary
      });
    } catch (error) {
      warnSkippedReport(reportId, 'report listing', error);
      continue;
    }
  }

  reports.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return reports;
}

async function clearAllReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  let clearedCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(path.join(REPORTS_DIR, entry.name, 'report.json'))) {
      clearedCount += 1;
    }
  }

  await replaceReportsDirectory();
  return clearedCount;
}

function scheduleReportsCleanup() {
  replaceReportsDirectory().catch(() => {});
}

async function removeTreeWithRetry(targetPath) {
  const delays = [100, 250, 500, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000];
  let lastError = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await fs.rm(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 250
      });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY', 'ENOENT', 'EACCES'].includes(error.code)) {
        throw error;
      }
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  throw lastError;
}

async function _removeTree(targetPath) {
  const stat = await fs.lstat(targetPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await _removeTree(path.join(targetPath, entry.name));
    }
    await fs.rmdir(targetPath);
    return;
  }

  await fs.unlink(targetPath);
}

async function replaceReportsDirectory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const trashPath = path.join(DATA_DIR, `.reports-trash-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  if (await pathExists(REPORTS_DIR)) {
    await fs.rename(REPORTS_DIR, trashPath);
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORTS_DIR, '.gitkeep'), '\n', 'utf8');

  removeTreeWithRetry(trashPath).catch(() => {});
}

async function getReport(reportId) {
  const cleanId = safeReportId(reportId);
  const hiddenReportIds = await readHiddenReportIds();
  if (hiddenReportIds.has(cleanId)) {
    return null;
  }
  const reportDir = path.join(REPORTS_DIR, cleanId);
  const reportJsonPath = path.join(reportDir, 'report.json');
  if (!(await pathExists(reportJsonPath))) {
    return null;
  }

  const raw = await readJsonFile(reportJsonPath);
  const parsed = parseReport(raw, { fallbackId: cleanId });
  const reportDirPhotos = path.join(reportDir, 'photos');
  const photoFolderExists = await pathExists(reportDirPhotos);

  const availablePhotoPaths = photoFolderExists ? await collectPhotoPaths(reportDirPhotos, 'photos') : [];
  const availablePhotoSet = new Set(availablePhotoPaths);
  const photoIdentityByPath = await buildPhotoIdentityMap(reportDir, availablePhotoPaths);
  const displayCards = buildDisplayCards(parsed.cards, availablePhotoSet, photoIdentityByPath);
  const summaryPath = path.join(reportDir, 'summary.json');
  const summary = await readStoredSummary(
    cleanId,
    summaryPath,
    displayCards,
    deriveSummary(parsed.summary, displayCards)
  );

  return {
    reportId: parsed.reportId,
    createdAt: parsed.createdAt,
    displayCreatedAt: formatDateValue(parsed.createdAt),
    deviceId: parsed.deviceId,
    user: parsed.user,
    author: resolveReportAuthor(parsed),
    testLocation: parsed.testLocation,
    summary,
    cards: displayCards,
    getPhotoUrl(photoPath) {
      if (typeof photoPath !== 'string' || !photoPath.trim()) return '';
      const normalized = photoPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (normalized.includes('://')) {
        return normalized;
      }

      const relativePath = normalized.startsWith('photos/') ? normalized : `photos/${normalized}`;
      try {
        reportPhotoPath(parsed.reportId, relativePath);
      } catch {
        return '';
      }

      return getStorageUrl(parsed.reportId, relativePath);
    },
    buildViewModel(filters = {}) {
      const cards = displayCards
        .filter((card) => matchesFilters(card, filters));
      return {
        ...this,
        cards,
        cardsCount: cards.length,
        filterOptions: buildFilterOptions(parsed.cards)
      };
    }
  };
}

async function collectPhotoPaths(rootDir, prefix = '') {
  const result = [];
  async function walk(currentDir, currentPrefix = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        result.push(relative.replace(/\\/g, '/'));
      }
    }
  }
  await walk(rootDir, prefix);
  return result;
}

function normalizeStoredPhotoPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

async function buildPhotoIdentityMap(reportDir, photoPaths = []) {
  const identities = new Map();
  for (const photoPath of photoPaths) {
    const normalized = normalizeStoredPhotoPath(photoPath);
    if (!normalized || normalized.includes('://')) continue;
    const absolutePath = path.join(reportDir, normalized);
    try {
      const buffer = await fs.readFile(absolutePath);
      identities.set(normalized, `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`);
    } catch {
      identities.set(normalized, normalized);
    }
  }
  return identities;
}

function filterDisplayPhotos(photos = [], availablePhotoSet = new Set(), photoIdentityByPath = new Map()) {
  const seen = new Set();
  return toArray(photos).filter((photo) => {
    if (typeof photo !== 'string' || !photo.trim()) return false;
    if (photo.startsWith('http')) return true;
    const normalized = normalizeStoredPhotoPath(photo);
    if (!availablePhotoSet.has(normalized)) return false;
    const identity = photoIdentityByPath.get(normalized) || normalized;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function buildDisplayCards(cards = [], availablePhotoSet = new Set(), photoIdentityByPath = new Map()) {
  return cards.map((card) => ({
    ...card,
    photos: filterDisplayPhotos(card.photos, availablePhotoSet, photoIdentityByPath),
    events: card.events.map((event) => ({
      ...event,
      photos: filterDisplayPhotos(event.photos, availablePhotoSet, photoIdentityByPath)
    }))
  }));
}

function countUniqueCardPhotos(card = {}) {
  const photos = new Set();
  for (const photo of toArray(card.photos)) {
    if (typeof photo === 'string' && photo.trim()) photos.add(normalizeStoredPhotoPath(photo));
  }
  for (const event of toArray(card.events)) {
    for (const photo of toArray(event && event.photos)) {
      if (typeof photo === 'string' && photo.trim()) photos.add(normalizeStoredPhotoPath(photo));
    }
  }
  return photos.size;
}

function buildFilterOptions(cards) {
  const unique = (getter) => [...new Set(cards.map(getter).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const stageOrder = new Map([
    ['введение в культуру', 0],
    ['клонирование', 1],
    ['адаптация', 2],
    ['теплица', 3],
    ['закалка', 4],
    ['высадка', 5]
  ]);
  const sortStages = (values) =>
    [...values].sort((left, right) => {
      const leftRank = stageOrder.has(String(left || '').trim().toLowerCase()) ? stageOrder.get(String(left || '').trim().toLowerCase()) : Number.POSITIVE_INFINITY;
      const rightRank = stageOrder.has(String(right || '').trim().toLowerCase()) ? stageOrder.get(String(right || '').trim().toLowerCase()) : Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.localeCompare(right, 'ru');
    });
  return {
    stages: sortStages(unique((card) => canonicalizeStage(card.stage))),
    cultures: unique((card) => card.culture),
    statuses: unique((card) => card.status),
    authors: unique((card) => card.author)
  };
}

function matchesFilters(card, filters) {
  const haystack = [
    card.code,
    card.culture,
    card.variety,
    card.sort,
    card.stage,
    card.status,
    card.location,
    card.problem,
    card.risk,
    card.author,
    card.date,
    card.searchText,
    ...card.events.flatMap((event) => [event.type, event.createdBy, event.author, event.comment, event.problem, event.risk, event.date]),
    ...card.photos
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.date) {
    const cardDate = formatDateOnly(card.date) || '';
    const eventDates = card.events.map((event) => formatDateOnly(event.date)).filter(Boolean);
    if (![cardDate, ...eventDates].some((value) => value === filters.date || value.includes(filters.date))) return false;
  }
  if (filters.author && card.author.toLowerCase() !== filters.author.toLowerCase()) return false;
  if (filters.stage && normalizeText(canonicalizeStage(card.stage)) !== normalizeText(canonicalizeStage(filters.stage))) return false;
  if (filters.culture && card.culture.toLowerCase() !== filters.culture.toLowerCase()) return false;
  if (filters.status && card.status.toLowerCase() !== filters.status.toLowerCase()) return false;
  if (filters.hasProblems === '1') {
    const hasProblem = isProblemLikeCard(card);
    if (!hasProblem) return false;
  }
  if (filters.hasPhotos === '1' && card.photos.length === 0 && card.events.every((event) => event.photos.length === 0)) {
    return false;
  }
  return true;
}

function readHiddenReportIdsSync() {
  if (!fsSync.existsSync(HIDDEN_REPORTS_PATH)) {
    return new Set();
  }

  try {
    return parseHiddenReportIdsState(fsSync.readFileSync(HIDDEN_REPORTS_PATH, 'utf8'));
  } catch (error) {
    throw createHiddenReportsStateError(error);
  }
}

function ensureVisibleReportId(reportId) {
  const cleanId = safeReportId(reportId);
  if (readHiddenReportIdsSync().has(cleanId)) {
    const error = new Error(`Hidden report: ${cleanId}`);
    error.userMessage = 'Запрошенный отчет скрыт.';
    error.statusCode = 404;
    error.internalCode = 'HIDDEN_REPORT';
    throw error;
  }
  return cleanId;
}

function resolveReportPath(reportId, relativePath, options = {}) {
  const cleanId = ensureVisibleReportId(reportId);
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);

  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    const error = new Error(`Unsafe report path: ${relativePath}`);
    error.userMessage = 'Запрошенный файл отчета не существует.';
    error.statusCode = 404;
    throw error;
  }

  if (options.mustStartWith && parts[0] !== options.mustStartWith) {
    const error = new Error(`Unexpected report path root: ${relativePath}`);
    error.userMessage = 'Запрошенный файл отчета не существует.';
    error.statusCode = 404;
    throw error;
  }

  const reportDir = path.join(REPORTS_DIR, cleanId);
  const target = path.join(reportDir, ...parts);
  ensureInside(reportDir, target);
  if (!fsSync.existsSync(target)) {
    const error = new Error(`Missing report file: ${normalized}`);
    error.userMessage = 'Запрошенный файл отчета не существует.';
    error.statusCode = 404;
    throw error;
  }

  if (options.mustBeFile) {
    const stat = fsSync.statSync(target);
    if (!stat.isFile()) {
      const error = new Error(`Report path is not a file: ${normalized}`);
      error.userMessage = 'Запрошенный файл отчета не существует.';
      error.statusCode = 404;
      throw error;
    }
  }

  return target;
}

function reportFilePath(reportId, fileName) {
  const safeName = path.basename(fileName);
  return resolveReportPath(reportId, safeName, { mustBeFile: true });
}

function reportPhotoPath(reportId, photoPath) {
  const normalized = String(photoPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const relativePath = normalized.startsWith('photos/') ? normalized : `photos/${normalized}`;
  return resolveReportPath(reportId, relativePath, { mustStartWith: 'photos', mustBeFile: true });
}

function normalizePhotoPaths(card, _reportId) {
  const photos = [];
  const pushPath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('://')) {
      photos.push(normalized);
      return;
    }
    if (normalized.startsWith('..')) return;
    if (normalized === 'report.json') return;
    photos.push(normalized);
  };
  const pushValue = (value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => pushValue(item));
      return;
    }
    if (value && typeof value === 'object') {
      const nested = firstString(value, ['uri', 'path', 'file', 'name', 'photoPath', 'photoUri']);
      if (nested) {
        pushPath(nested);
        return;
      }
      pushValue(value.photoPaths);
      pushValue(value.photoUris);
      pushValue(value.photoFiles);
      pushValue(value.photos);
      pushValue(value.images);
    }
    pushPath(value);
  };

  pushValue(card.photos);
  pushValue(card.photoFiles);
  pushValue(card.photoPath);
  pushValue(card.photoPaths);
  pushValue(card.images);
  pushValue(card.photoUri);
  pushValue(card.photoUris);
  pushValue(card.startPhotoUri);
  pushValue(card.startPhotoUris);
  toArray(card.events).forEach((event) => {
    pushValue(event && event.photos);
    pushValue(event && event.photoFiles);
    pushValue(event && event.photoPath);
    pushValue(event && event.photoPaths);
    pushValue(event && event.images);
    pushValue(event && event.photoUri);
    pushValue(event && event.photoUris);
  });

  return [...new Set(photos)];
}

function normalizeEvent(event, index, options = {}) {
  const reserved = new Set(['eventId', 'createdBy', 'date', 'createdAt', 'time', 'timestamp', 'type', 'eventType', 'title', 'stage', 'author', 'user', 'userName', 'comment', 'message', 'problem', 'problemType', 'risk', 'riskLevel', 'quantity', 'count', 'previousQuantity', 'currentQuantity', 'parentCardId', 'parentCode', 'childCardId', 'childCode', 'sourceEventId', 'sourceProblemEventId', 'generation', 'propagationMethod', 'healthStatus', 'isolationStatus', 'activeProblemQuantity', 'unisolatedProblemQuantity', 'photos', 'photoFiles', 'photoPath', 'photoPaths', 'images', 'photoUri', 'photoUris', 'extraFields']);
  const createdAt = firstString(event, ['createdAt', 'timestamp']) || firstString(event, ['date', 'time']);
  const date = firstString(event, ['date']) || createdAt;
  const time = firstString(event, ['time']) || '';
  const timestamp = firstString(event, ['timestamp']) || '';
  const type = firstString(event, ['type', 'eventType', 'name']) || `Event ${index + 1}`;
  const author = firstString(event, ['author', 'user', 'userName']);
  const rawCreatedBy = firstString(event, ['createdBy']);
  const fallbackCreatedBy = author || options.fallbackCreatedBy || 'Неизвестно';
  const reportUserId = firstString(options, ['reportUserId']);
  const createdBy = isUnknownAuthor(rawCreatedBy) || (reportUserId && normalizeText(rawCreatedBy) === normalizeText(reportUserId))
    ? fallbackCreatedBy
    : rawCreatedBy || fallbackCreatedBy;
  const eventId = firstString(event, ['eventId']) || `${options.reportId || 'report'}-${options.cardIndex || 0}-${index + 1}`;
  const title = firstString(event, ['title']) || type;
  const stage = firstString(event, ['stage']);
  const comment = firstString(event, ['comment', 'message', 'text', 'details']);
  const problem = firstString(event, ['problem']);
  const problemType = firstString(event, ['problemType']) || problem;
  const risk = firstString(event, ['risk']);
  const riskLevel = firstString(event, ['riskLevel']) || risk;
  const quantity = firstString(event, ['quantity', 'count']);
  const previousQuantity = firstString(event, ['previousQuantity']);
  const currentQuantity = firstString(event, ['currentQuantity']);
  const parentCardId = firstString(event, ['parentCardId']);
  const parentCode = firstString(event, ['parentCode']);
  const childCardId = firstString(event, ['childCardId']);
  const childCode = firstString(event, ['childCode']);
  const sourceEventId = firstString(event, ['sourceEventId']);
  const sourceProblemEventId = firstString(event, ['sourceProblemEventId']);
  const generation = firstString(event, ['generation']);
  const propagationMethod = firstString(event, ['propagationMethod']);
  const healthStatus = firstString(event, ['healthStatus']);
  const isolationStatus = firstString(event, ['isolationStatus']);
  const activeProblemQuantity = firstString(event, ['activeProblemQuantity']);
  const unisolatedProblemQuantity = firstString(event, ['unisolatedProblemQuantity']);
  const extraFields = pickExtraFields(event || {}, reserved);
  if (event && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields)) {
    Object.assign(extraFields, event.extraFields);
  }
  const extraProblem = firstString(extraFields, ['problem', 'problemType']);
  const extraRisk = firstString(extraFields, ['risk', 'riskLevel']);

  return {
    eventId,
    createdBy,
    date,
    createdAt,
    time,
    timestamp,
    type,
    title,
    stage,
    author,
    comment,
    problem: problem || extraProblem,
    problemType: problemType || extraProblem,
    risk: risk || extraRisk,
    riskLevel: riskLevel || extraRisk,
    quantity,
    previousQuantity,
    currentQuantity,
    parentCardId,
    parentCode,
    childCardId,
    childCode,
    sourceEventId,
    sourceProblemEventId,
    generation,
    propagationMethod,
    healthStatus,
    isolationStatus,
    activeProblemQuantity,
    unisolatedProblemQuantity,
    photos: normalizePhotoPaths(event || {}, ''),
    extraFields
  };
}

function normalizeCard(card, index, reportId, reportContext = '') {
  const reserved = new Set([
    'cardId',
    'code',
    'cultureName',
    'speciesName',
    'varietyName',
    'partyCode',
    'culture',
    'variety',
    'sort',
    'stage',
    'batchStatus',
    'status',
    'sterilityStatus',
    'quantity',
    'initialCount',
    'currentQuantity',
    'currentCount',
    'locationDescription',
    'location',
    'place',
    'problem',
    'problemType',
    'risk',
    'riskLevel',
    'activeProblemQuantity',
    'healthyQuantity',
    'healthStatus',
    'isolationStatus',
    'unisolatedProblemQuantity',
    'originType',
    'parentCardId',
    'parentCode',
    'sourceEventId',
    'sourceProblemEventId',
    'childCardId',
    'childCode',
    'generation',
    'propagatedAt',
    'propagationMethod',
    'createdAt',
    'updatedAt',
    'events',
    'photos',
    'photoFiles',
    'photoPath',
    'photoPaths',
    'images',
    'photoUri',
    'photoUris',
    'startPhotoUri',
    'startPhotoUris',
    'date',
    'author',
    'extraFields'
  ]);

  const reportMetadata = reportContext && typeof reportContext === 'object'
    ? reportContext
    : { reportAuthor: reportContext };
  const reportAuthor = firstString(reportMetadata, ['reportAuthor']);
  const reportUserId = firstString(reportMetadata, ['reportUserId']);
  const fallbackCreatedBy = firstString(card, ['author', 'user', 'userName']) || reportAuthor;
  const events = toArray(card.events).map((event, eventIndex) => normalizeEvent(event, eventIndex, {
    reportId,
    cardIndex: index + 1,
    fallbackCreatedBy,
    reportUserId
  }));
  const photos = normalizePhotoPaths(card, reportId);
  const cardId = firstString(card, ['cardId']) || `card-${index + 1}`;
  const code = firstString(card, ['code', 'partyCode', 'partyId', 'party_id', 'id']) || `card-${index + 1}`;
  const cultureName = firstVisibleString(card, ['cultureName', 'culture', 'crop', 'plant']);
  const speciesName = firstVisibleString(card, ['speciesName', 'sort', 'grade']);
  const varietyName = firstVisibleString(card, ['varietyName', 'variety', 'cultivar']);
  const culture = cultureName;
  const variety = varietyName;
  const sort = speciesName;
  const stage = canonicalizeStage(firstString(card, ['stage', 'phase']));
  const batchStatus = firstString(card, ['batchStatus', 'status', 'partyStatus']);
  const status = batchStatus;
  const sterilityStatus = firstString(card, ['sterilityStatus']);
  const quantity = firstString(card, ['quantity', 'initialCount', 'startCount', 'plannedCount']);
  const initialCount = quantity;
  const currentQuantity = firstString(card, ['currentQuantity', 'currentCount', 'remainingCount', 'balance']);
  const currentCount = currentQuantity;
  const locationDescription = firstString(card, ['locationDescription', 'location', 'place', 'position']);
  const location = locationDescription;
  const problem = firstString(card, ['problem']);
  const problemType = firstString(card, ['problemType']) || problem;
  const risk = firstString(card, ['risk']);
  const riskLevel = firstString(card, ['riskLevel']) || risk;
  const activeProblemQuantity = firstString(card, ['activeProblemQuantity']);
  const healthyQuantity = firstString(card, ['healthyQuantity']);
  const healthStatus = firstString(card, ['healthStatus']);
  const isolationStatus = firstString(card, ['isolationStatus']);
  const unisolatedProblemQuantity = firstString(card, ['unisolatedProblemQuantity']);
  const originType = firstString(card, ['originType']);
  const parentCardId = firstString(card, ['parentCardId']);
  const parentCode = firstString(card, ['parentCode']);
  const sourceEventId = firstString(card, ['sourceEventId']);
  const sourceProblemEventId = firstString(card, ['sourceProblemEventId']);
  const childCardId = firstString(card, ['childCardId']);
  const childCode = firstString(card, ['childCode']);
  const generation = firstString(card, ['generation']);
  const propagatedAt = firstString(card, ['propagatedAt']);
  const propagationMethod = firstString(card, ['propagationMethod']);
  const createdAt = firstString(card, ['createdAt', 'date', 'time']);
  const updatedAt = firstString(card, ['updatedAt']);
  const date = createdAt;
  const author = firstString(card, ['author', 'user', 'userName']) || reportAuthor;

  const searchableText = [];
  flattenText(card, searchableText);

  const extraFields = pickExtraFields(card || {}, reserved);
  if (card && typeof card.extraFields === 'object' && !Array.isArray(card.extraFields)) {
    Object.assign(extraFields, card.extraFields);
  }
  const extraProblem = firstString(extraFields, ['problem', 'problemType']);
  const extraRisk = firstString(extraFields, ['risk', 'riskLevel']);

  return {
    index,
    cardId,
    code,
    cultureName,
    speciesName,
    varietyName,
    culture,
    variety,
    sort,
    stage,
    batchStatus,
    status,
    sterilityStatus,
    quantity,
    initialCount,
    currentQuantity,
    currentCount,
    locationDescription,
    location,
    problem: problem || extraProblem,
    problemType: problemType || extraProblem,
    risk: risk || extraRisk,
    riskLevel: riskLevel || extraRisk,
    activeProblemQuantity,
    healthyQuantity,
    healthStatus,
    isolationStatus,
    unisolatedProblemQuantity,
    originType,
    parentCardId,
    parentCode,
    sourceEventId,
    sourceProblemEventId,
    childCardId,
    childCode,
    generation,
    propagatedAt,
    propagationMethod,
    createdAt,
    updatedAt,
    date,
    author,
    events,
    photos,
    extraFields,
    searchText: searchableText.join(' ').toLowerCase()
  };
}

function deriveSummary(rawSummary, cards) {
  const summary = {
    cardsCount: cards.length,
    eventsCount: 0,
    photosCount: 0,
    problemsCount: 0,
    problemCount: 0,
    activeCount: 0,
    soldCount: 0,
    quarantineCount: 0,
    partialCount: 0,
    archivedCount: 0,
    lossCount: 0
  };

  const lossTypes = new Set(['loss', 'introloss', 'death', 'discard', 'writeoff']);

  for (const card of cards) {
    summary.eventsCount += card.events.length;
    summary.photosCount += countUniqueCardPhotos(card);
    if (isProblemLikeCard(card)) {
      summary.problemsCount += 1;
    }

    const status = String(card.status || '').toLowerCase();
    if (status.includes('active')) summary.activeCount += 1;
    if (status.includes('sold')) summary.soldCount += 1;
    if (status.includes('quarantine')) summary.quarantineCount += 1;
    if (status.includes('partial')) summary.partialCount += 1;
    if (status.includes('archiv')) summary.archivedCount += 1;

    for (const event of card.events) {
      const eventType = String(event.type || event.title || '').toLowerCase();
      if (lossTypes.has(eventType) || eventType.includes('loss') || eventType.includes('discard') || eventType.includes('death')) {
        summary.lossCount += 1;
      }
    }
  }

  if (rawSummary && typeof rawSummary === 'object') {
    for (const key of Object.keys(summary)) {
      if (key === 'photosCount') continue;
      const value = toFiniteSummaryNumber(rawSummary[key]);
      if (value !== null) {
        summary[key] = value;
      }
    }
    const problemCount = toFiniteSummaryNumber(rawSummary.problemCount);
    if (problemCount !== null) {
      summary.problemCount = problemCount;
      summary.problemsCount = problemCount;
    }
    const problemsCount = toFiniteSummaryNumber(rawSummary.problemsCount);
    if (problemsCount !== null) {
      summary.problemsCount = problemsCount;
    }
    const lossCount = toFiniteSummaryNumber(rawSummary.lossCount);
    if (lossCount !== null) {
      summary.lossCount = lossCount;
    }
  }

  if (!Number.isFinite(summary.problemCount) || summary.problemCount < 0) {
    summary.problemCount = summary.problemsCount;
  }
  if (!Number.isFinite(summary.problemsCount) || summary.problemsCount < 0) {
    summary.problemsCount = summary.problemCount;
  }
  if (summary.problemCount === 0 && summary.problemsCount > 0) {
    summary.problemCount = summary.problemsCount;
  }
  if (summary.problemsCount === 0 && summary.problemCount > 0) {
    summary.problemsCount = summary.problemCount;
  }

  return summary;
}

function isProblemLikeEvent(event = {}) {
  const eventType = String(event.type || event.title || '')
    .toLowerCase()
    .replace(/[^a-zа-яё]/g, '');
  const extraFields = event && event.extraFields && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields)
    ? event.extraFields
    : {};

  return Boolean(
    event.problem ||
    event.problemType ||
    event.risk ||
    event.riskLevel ||
    extraFields.problem ||
    extraFields.problemType ||
    extraFields.risk ||
    extraFields.riskLevel ||
    extraFields.problemDescription ||
    extraFields.diseaseName ||
    extraFields.pestName ||
    extraFields.quarantineReason ||
    event.problemDescription ||
    event.diseaseName ||
    event.pestName ||
    event.quarantineReason ||
    ['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease'].includes(eventType)
  );
}

function isProblemLikeCard(card = {}) {
  const extraFields = card && card.extraFields && typeof card.extraFields === 'object' && !Array.isArray(card.extraFields)
    ? card.extraFields
    : {};

  return Boolean(
    card.problem ||
    card.problemType ||
    card.risk ||
    card.riskLevel ||
    extraFields.problem ||
    extraFields.problemType ||
    extraFields.risk ||
    extraFields.riskLevel ||
    extraFields.problemDescription ||
    extraFields.diseaseName ||
    extraFields.pestName ||
    extraFields.quarantineReason ||
    String(card.batchStatus || card.status || '').toLowerCase().includes('problem') ||
    String(card.batchStatus || card.status || '').toLowerCase().includes('risk') ||
    String(card.batchStatus || card.status || '').toLowerCase().includes('quarantine') ||
    String(card.sterilityStatus || '').toLowerCase().includes('contamin') ||
    card.events.some((event) => isProblemLikeEvent(event))
  );
}

module.exports = {
  listReports,
  clearAllReports,
  scheduleReportsCleanup,
  getReport,
  processUploadedReport,
  safeReportId,
  reportFilePath,
  reportPhotoPath,
  formatDateValue,
  formatDateOnly,
  getStorageUrl
};


