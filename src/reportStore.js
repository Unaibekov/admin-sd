const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');
const { pipeline } = require('stream/promises');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const HIDDEN_REPORTS_PATH = path.join(REPORTS_DIR, '.hidden-report-ids.json');
function safeReportId(value) {
  const input = String(value || '').trim();
  const cleaned = input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'report';
}

function ensureInside(basePath, targetPath) {
  const resolvedBase = path.resolve(basePath) + path.sep;
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    const error = new Error('Обнаружен небезопасный путь в архиве.');
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

async function readHiddenReportIds() {
  try {
    const content = await fs.readFile(HIDDEN_REPORTS_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.map((value) => safeReportId(value)).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function writeHiddenReportIds(reportIds) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const uniqueIds = [...new Set(reportIds.map((value) => safeReportId(value)).filter(Boolean))].sort();
  await fs.writeFile(HIDDEN_REPORTS_PATH, `${JSON.stringify(uniqueIds, null, 2)}\n`, 'utf8');
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

function normalizePhotoPaths(card, reportId) {
  const photos = [];
  const pushPath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.startsWith('..')) return;
    if (normalized === 'report.json') return;
    if (normalized.includes('://')) return;
    photos.push(normalized);
  };
  const pushValue = (value) => {
    if (Array.isArray(value)) {
      value.forEach(pushPath);
      return;
    }
    if (value && typeof value === 'object') {
      const nested = firstString(value, ['uri', 'path', 'file', 'name']);
      if (nested) {
        pushPath(nested);
        return;
      }
    }
    pushPath(value);
  };

  pushValue(card.photos);
  pushValue(card.photoFiles);
  pushValue(card.photoPaths);
  pushValue(card.images);
  pushValue(card.startPhotoUri);
  pushValue(card.startPhotoUris);
  toArray(card.events).forEach((event) => {
    pushValue(event && event.photos);
    pushValue(event && event.photoFiles);
    pushValue(event && event.photoPaths);
    pushValue(event && event.images);
    pushValue(event && event.photoUri);
    pushValue(event && event.photoUris);
  });

  return [...new Set(photos)];
}

function normalizeEvent(event, index, options = {}) {
  const reserved = new Set(['eventId', 'createdBy', 'date', 'createdAt', 'type', 'eventType', 'author', 'user', 'userName', 'comment', 'message', 'problem', 'risk', 'quantity', 'count', 'photos', 'photoPaths', 'images']);
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

function normalizeCard(card, index, reportId) {
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
    'photoPaths',
    'images',
    'problem',
    'risk',
    'date',
    'author'
  ]);

  const fallbackCreatedBy = firstString(card, ['author', 'user', 'userName']);
  const events = toArray(card.events).map((event, eventIndex) => normalizeEvent(event, eventIndex, {
    reportId,
    cardIndex: index + 1,
    fallbackCreatedBy
  }));
  const photos = normalizePhotoPaths(card, reportId);
  const code = firstString(card, ['code', 'partyCode', 'partyId', 'party_id', 'id']) || `card-${index + 1}`;
  const culture = firstString(card, ['culture', 'crop', 'plant']);
  const variety = firstString(card, ['variety', 'cultivar']);
  const sort = firstString(card, ['sort', 'grade']);
  const stage = firstString(card, ['stage', 'phase']);
  const status = firstString(card, ['status', 'partyStatus']);
  const initialCount = firstString(card, ['initialCount', 'startCount', 'plannedCount']);
  const currentCount = firstString(card, ['currentCount', 'remainingCount', 'balance']);
  const location = firstString(card, ['location', 'place', 'position']);
  const problem = firstString(card, ['problem']);
  const risk = firstString(card, ['risk']);
  const date = firstString(card, ['date', 'createdAt', 'time']);
  const author = firstString(card, ['author', 'user', 'userName']);

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

function deriveSummary(rawSummary, cards) {
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
    summary.photosCount += card.photos.length + card.events.reduce((total, event) => total + event.photos.length, 0);
    if (card.problem || card.risk || card.events.some((event) => event.problem || event.risk)) {
      summary.problemsCount += 1;
    }

    const status = String(card.status || '').toLowerCase();
    if (status.includes('active')) summary.activeCount += 1;
    if (status.includes('sold')) summary.soldCount += 1;
  }

  if (rawSummary && typeof rawSummary === 'object') {
    for (const key of Object.keys(summary)) {
      const value = rawSummary[key];
      if (Number.isFinite(Number(value))) {
        summary[key] = Number(value);
      }
    }
  }

  return summary;
}

function getStorageUrl(reportId, relativePath) {
  const cleanId = safeReportId(reportId);
  const cleanPath = relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/storage/reports/${encodeURIComponent(cleanId)}/${cleanPath}`;
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

function parseReport(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const error = new Error('report.json должен быть объектом.');
    error.userMessage = 'В report.json должен быть JSON-объект.';
    error.statusCode = 400;
    throw error;
  }

  const reportId = safeReportId(raw.reportId || options.fallbackId || 'report');
  const cards = toArray(raw.cards).map((card, index) => normalizeCard(card, index, reportId));
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

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonFile(targetPath) {
  const content = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
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

async function extractArchive(archivePath, targetDir) {
  const directory = await unzipper.Open.file(archivePath);
  let foundReport = false;

  for (const file of directory.files) {
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.startsWith('__MACOSX/')) {
      continue;
    }

    if (normalizedPath !== 'report.json' && !normalizedPath.startsWith('photos/')) {
      const error = new Error(`Неожиданный файл в архиве: ${normalizedPath}`);
      error.userMessage = 'Архив может содержать только report.json и папку photos/.';
      error.statusCode = 400;
      throw error;
    }

    const targetPath = path.join(targetDir, normalizedPath);
    ensureInside(targetDir, targetPath);

    if (file.type === 'Directory') {
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
    const error = new Error('В архиве отсутствует report.json.');
    error.userMessage = 'Архив должен содержать report.json.';
    error.statusCode = 400;
    throw error;
  }
}

async function processUploadedReport(buffer, originalName) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-'));
  const archivePath = path.join(tempRoot, 'upload.zip');
  const extractedDir = path.join(tempRoot, 'extracted');

  try {
    await fs.writeFile(archivePath, buffer);
    await extractArchive(archivePath, extractedDir);

    const reportJsonPath = path.join(extractedDir, 'report.json');
    const rawReport = await readJsonFile(reportJsonPath);
    const parsed = parseReport(rawReport, { fallbackId: path.parse(originalName).name });

    let finalReportId = parsed.reportId;
    let reportDir = path.join(REPORTS_DIR, finalReportId);
    let suffix = 2;
    while (await pathExists(reportDir)) {
      finalReportId = `${parsed.reportId}-${suffix}`;
      reportDir = path.join(REPORTS_DIR, finalReportId);
      suffix += 1;
    }

    parsed.reportId = finalReportId;
    rawReport.reportId = finalReportId;
    rawReport.cards = toArray(rawReport.cards).map((card, cardIndex) => {
      const normalizedCard = parsed.cards[cardIndex] || { events: [] };
      const events = toArray(card.events).map((event, eventIndex) => ({
        ...event,
        eventId: normalizedCard.events[eventIndex] ? normalizedCard.events[eventIndex].eventId : `${finalReportId}-${cardIndex + 1}-${eventIndex + 1}`,
        createdBy: normalizedCard.events[eventIndex] ? normalizedCard.events[eventIndex].createdBy : firstString(event, ['createdBy']) || firstString(event, ['author', 'user', 'userName']) || 'Неизвестно'
      }));
      return {
        ...card,
        events
      };
    });
    await fs.mkdir(reportDir, { recursive: true });

    await writeJson(path.join(reportDir, 'report.json'), rawReport);
    await writeJson(path.join(reportDir, 'summary.json'), parsed.summary);

    const photosDir = path.join(extractedDir, 'photos');
    await fs.mkdir(path.join(reportDir, 'photos'), { recursive: true });
    const hasPhotos = await pathExists(photosDir);
    if (hasPhotos) {
      await copyDirectory(photosDir, path.join(reportDir, 'photos'));
    }

    await fs.copyFile(archivePath, path.join(reportDir, 'original.zip'));
    return finalReportId;
  } catch (error) {
    if (!error.userMessage) {
      error.userMessage = error.message || 'Не удалось обработать загруженный архив.';
      error.statusCode = error.statusCode || 400;
    }
    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function listReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  const hiddenReportIds = await readHiddenReportIds();
  const reports = [];

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
      let summary = parsed.summary;
      if (await pathExists(summaryJsonPath)) {
        const storedSummary = await readJsonFile(summaryJsonPath);
        summary = deriveSummary(storedSummary, parsed.cards);
      }

      reports.push({
        reportId: parsed.reportId,
        createdAt: parsed.createdAt,
        displayCreatedAt: formatDateValue(parsed.createdAt),
        author: parsed.user.displayName || 'Автор не указан',
        deviceId: parsed.deviceId,
        testLocation: parsed.testLocation,
        summary
      });
    } catch {
      continue;
    }
  }

  reports.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return reports;
}

async function clearAllReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  const hiddenReportIds = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    hiddenReportIds.add(safeReportId(entry.name));
  }

  await writeHiddenReportIds([...hiddenReportIds]);
  return hiddenReportIds.size;
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

async function removeTree(targetPath) {
  const stat = await fs.lstat(targetPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await removeTree(path.join(targetPath, entry.name));
    }
    await fs.rmdir(targetPath);
    return;
  }

  await fs.unlink(targetPath);
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
  const summaryPath = path.join(reportDir, 'summary.json');
  let summary = parsed.summary;
  if (await pathExists(summaryPath)) {
    const storedSummary = await readJsonFile(summaryPath);
    summary = deriveSummary(storedSummary, parsed.cards);
  }

  return {
    reportId: parsed.reportId,
    createdAt: parsed.createdAt,
    displayCreatedAt: formatDateValue(parsed.createdAt),
    deviceId: parsed.deviceId,
    user: parsed.user,
    testLocation: parsed.testLocation,
    summary,
    cards: parsed.cards.map((card) => ({
      ...card,
      photos: card.photos.filter((photo) => availablePhotoSet.has(photo) || photo.startsWith('http')),
      events: card.events.map((event) => ({
        ...event,
        photos: event.photos.filter((photo) => availablePhotoSet.has(photo) || photo.startsWith('http'))
      }))
    })),
    getPhotoUrl(photoPath) {
      if (typeof photoPath !== 'string' || !photoPath.trim()) return '';
      const normalized = photoPath.replace(/\\/g, '/').replace(/^\/+/, '');
      return getStorageUrl(parsed.reportId, normalized.startsWith('photos/') ? normalized : `photos/${normalized}`);
    },
    buildViewModel(filters = {}) {
      const cards = parsed.cards
        .map((card) => ({
          ...card,
          photos: card.photos.filter((photo) => availablePhotoSet.has(photo) || photo.startsWith('http')),
          events: card.events.map((event) => ({
            ...event,
            photos: event.photos.filter((photo) => availablePhotoSet.has(photo) || photo.startsWith('http'))
          }))
        }))
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
    stages: sortStages(unique((card) => card.stage)),
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
    ...card.events.flatMap((event) => [event.type, event.author, event.comment, event.problem, event.risk, event.date]),
    ...card.photos
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.date) {
    const cardDate = formatDateOnly(card.date) || '';
    const eventDate = card.events.map((event) => formatDateOnly(event.date)).find(Boolean) || '';
    if (![cardDate, eventDate].some((value) => value === filters.date || value.includes(filters.date))) return false;
  }
  if (filters.author && card.author.toLowerCase() !== filters.author.toLowerCase()) return false;
  if (filters.stage && card.stage.toLowerCase() !== filters.stage.toLowerCase()) return false;
  if (filters.culture && card.culture.toLowerCase() !== filters.culture.toLowerCase()) return false;
  if (filters.status && card.status.toLowerCase() !== filters.status.toLowerCase()) return false;
  if (filters.hasProblems === '1') {
    const hasProblem = Boolean(card.problem || card.risk || card.events.some((event) => event.problem || event.risk));
    if (!hasProblem) return false;
  }
  if (filters.hasPhotos === '1' && card.photos.length === 0 && card.events.every((event) => event.photos.length === 0)) {
    return false;
  }
  return true;
}

function reportFilePath(reportId, fileName) {
  const cleanId = safeReportId(reportId);
  const safeName = path.basename(fileName);
  if (fsSync.existsSync(HIDDEN_REPORTS_PATH)) {
    try {
      const hidden = JSON.parse(fsSync.readFileSync(HIDDEN_REPORTS_PATH, 'utf8'));
      const hiddenSet = new Set(Array.isArray(hidden) ? hidden.map((value) => safeReportId(value)).filter(Boolean) : []);
      if (hiddenSet.has(cleanId)) {
        const error = new Error(`Отчет скрыт: ${cleanId}`);
        error.userMessage = 'Запрошенный отчет очищен.';
        error.statusCode = 404;
        throw error;
      }
    } catch (error) {
      if (error && error.statusCode) {
        throw error;
      }
    }
  }
  const target = path.join(REPORTS_DIR, cleanId, safeName);
  if (!fsSync.existsSync(target)) {
    const error = new Error(`Отсутствует файл: ${safeName}`);
    error.userMessage = 'Запрошенный файл отчета не существует.';
    error.statusCode = 404;
    throw error;
  }
  return target;
}

function normalizePhotoPaths(card, reportId) {
  const photos = [];
  const pushPath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.startsWith('..')) return;
    if (normalized === 'report.json') return;
    if (normalized.includes('://')) return;
    photos.push(normalized);
  };
  const pushValue = (value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => pushValue(item));
      return;
    }
    if (value && typeof value === 'object') {
      const nested = firstString(value, ['uri', 'path', 'file', 'name']);
      if (nested) {
        pushPath(nested);
        return;
      }
    }
    pushPath(value);
  };

  pushValue(card.photos);
  pushValue(card.photoFiles);
  pushValue(card.photoPaths);
  pushValue(card.images);
  pushValue(card.startPhotoUri);
  pushValue(card.startPhotoUris);
  toArray(card.events).forEach((event) => {
    pushValue(event && event.photos);
    pushValue(event && event.photoFiles);
    pushValue(event && event.photoPaths);
    pushValue(event && event.images);
    pushValue(event && event.photoUri);
    pushValue(event && event.photoUris);
  });

  return [...new Set(photos)];
}

function normalizeEvent(event, index, options = {}) {
  const reserved = new Set(['eventId', 'createdBy', 'date', 'createdAt', 'time', 'timestamp', 'type', 'eventType', 'title', 'stage', 'author', 'user', 'userName', 'comment', 'message', 'photoNote', 'problem', 'problemType', 'risk', 'riskLevel', 'quantity', 'count', 'previousQuantity', 'currentQuantity', 'photos', 'photoFiles', 'photoPaths', 'images', 'photoUri', 'photoUris', 'extraFields']);
  const createdAt = firstString(event, ['createdAt', 'timestamp']) || firstString(event, ['date', 'time']);
  const date = firstString(event, ['date']) || createdAt;
  const time = firstString(event, ['time']) || '';
  const timestamp = firstString(event, ['timestamp']) || '';
  const type = firstString(event, ['type', 'eventType', 'name']) || `Event ${index + 1}`;
  const author = firstString(event, ['author', 'user', 'userName']);
  const createdBy = firstString(event, ['createdBy']) || author || options.fallbackCreatedBy || 'Неизвестно';
  const eventId = firstString(event, ['eventId']) || `${options.reportId || 'report'}-${options.cardIndex || 0}-${index + 1}`;
  const title = firstString(event, ['title']) || type;
  const stage = firstString(event, ['stage']);
  const comment = firstString(event, ['comment', 'message', 'text', 'details']);
  const photoNote = firstString(event, ['photoNote']);
  const problem = firstString(event, ['problem']);
  const problemType = firstString(event, ['problemType']) || problem;
  const risk = firstString(event, ['risk']);
  const riskLevel = firstString(event, ['riskLevel']) || risk;
  const quantity = firstString(event, ['quantity', 'count']);
  const previousQuantity = firstString(event, ['previousQuantity']);
  const currentQuantity = firstString(event, ['currentQuantity']);
  const extraFields = pickExtraFields(event || {}, reserved);
  if (event && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields)) {
    Object.assign(extraFields, event.extraFields);
  }

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
    photoNote,
    problem,
    problemType,
    risk,
    riskLevel,
    quantity,
    previousQuantity,
    currentQuantity,
    photos: normalizePhotoPaths(event || {}, ''),
    extraFields
  };
}

function normalizeCard(card, index, reportId) {
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
    'createdAt',
    'updatedAt',
    'events',
    'photos',
    'photoFiles',
    'photoPaths',
    'images',
    'date',
    'author',
    'extraFields'
  ]);

  const fallbackCreatedBy = firstString(card, ['author', 'user', 'userName']);
  const events = toArray(card.events).map((event, eventIndex) => normalizeEvent(event, eventIndex, {
    reportId,
    cardIndex: index + 1,
    fallbackCreatedBy
  }));
  const photos = normalizePhotoPaths(card, reportId);
  const cardId = firstString(card, ['cardId']) || `card-${index + 1}`;
  const code = firstString(card, ['code', 'partyCode', 'partyId', 'party_id', 'id']) || `card-${index + 1}`;
  const cultureName = firstString(card, ['cultureName', 'culture', 'crop', 'plant']);
  const speciesName = firstString(card, ['speciesName', 'sort', 'grade']);
  const varietyName = firstString(card, ['varietyName', 'variety', 'cultivar']);
  const culture = cultureName;
  const variety = varietyName;
  const sort = speciesName;
  const stage = firstString(card, ['stage', 'phase']);
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
  const createdAt = firstString(card, ['createdAt', 'date', 'time']);
  const updatedAt = firstString(card, ['updatedAt']);
  const date = createdAt;
  const author = firstString(card, ['author', 'user', 'userName']);

  const searchableText = [];
  flattenText(card, searchableText);

  const extraFields = pickExtraFields(card || {}, reserved);
  if (card && typeof card.extraFields === 'object' && !Array.isArray(card.extraFields)) {
    Object.assign(extraFields, card.extraFields);
  }

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
    problem,
    problemType,
    risk,
    riskLevel,
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
    summary.photosCount += card.photos.length + card.events.reduce((total, event) => total + event.photos.length, 0);
    if (
      card.problem ||
      card.problemType ||
      card.risk ||
      card.riskLevel ||
      String(card.batchStatus || card.status || '').toLowerCase().includes('problem') ||
      String(card.batchStatus || card.status || '').toLowerCase().includes('risk') ||
      String(card.batchStatus || card.status || '').toLowerCase().includes('quarantine') ||
      String(card.sterilityStatus || '').toLowerCase().includes('contamin') ||
      card.events.some((event) => event.problem || event.problemType || event.risk || event.riskLevel)
    ) {
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
      const value = rawSummary[key];
      if (Number.isFinite(Number(value))) {
        summary[key] = Number(value);
      }
    }
    if (Number.isFinite(Number(rawSummary.problemCount))) {
      summary.problemCount = Number(rawSummary.problemCount);
      summary.problemsCount = Number(rawSummary.problemCount);
    }
    if (Number.isFinite(Number(rawSummary.problemsCount))) {
      summary.problemsCount = Number(rawSummary.problemsCount);
    }
    if (Number.isFinite(Number(rawSummary.lossCount))) {
      summary.lossCount = Number(rawSummary.lossCount);
    }
  }

  return summary;
}

module.exports = {
  listReports,
  clearAllReports,
  getReport,
  processUploadedReport,
  safeReportId,
  reportFilePath,
  formatDateValue,
  formatDateOnly,
  getStorageUrl
};

