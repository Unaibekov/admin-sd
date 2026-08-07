const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const STAGE_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'important', label: 'Важное' },
  ...STAGE_ORDER.map((label) => ({ key: label, label }))
];

const SUBTAB_LABELS = {
  all: 'Все',
  important: 'Важное',
  problems: 'Проблемы',
  movement: 'Перемещения',
  losses: 'Потери',
  sales: 'Продажи',
  rooting: 'Укоренение',
  propagation: 'Размножение',
  observation: 'Наблюдения',
  care: 'Уход',
  transplant: 'Пересадка',
  planting: 'Высадка',
  completion: 'Завершение'
};

const STAGE_SUBTABS = {
  all: ['all', 'problems', 'movement', 'losses', 'sales', 'observation', 'care', 'rooting', 'propagation', 'transplant', 'planting', 'completion'],
  important: ['all', 'problems'],
  'Введение в культуру': ['all', 'problems', 'movement', 'losses', 'sales'],
  'Клонирование': ['all', 'rooting', 'propagation', 'problems', 'movement', 'losses', 'sales'],
  'Адаптация': ['all', 'observation', 'care', 'problems', 'movement', 'losses', 'sales'],
  'Теплица': ['all', 'observation', 'care', 'problems', 'transplant', 'movement', 'losses', 'sales'],
  'Закалка': ['all', 'observation', 'care', 'problems', 'movement', 'losses', 'sales'],
  'Высадка': ['all', 'planting', 'observation', 'care', 'problems', 'completion', 'movement', 'losses', 'sales']
};

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
  ...STAGE_ORDER.map((label) => [normalizeText(label), label]),
  ...Object.entries(STAGE_ALIASES).map(([alias, stage]) => [normalizeText(alias), stage])
]);
const STAGE_PRIORITY = new Map(STAGE_ORDER.map((label, index) => [normalizeText(label), index]));

function isUnknownAuthor(value) {
  return ['unknown', 'неизвестно', 'local-user'].includes(String(value || '').trim().toLowerCase());
}

function buildJournalModel(report, query = {}) {
  const cards = normalizeCards(report);
  const allEntries = normalizeReportEntries(cards);
  const selectedStage = resolveStage(query.stage);
  const stageEntries = filterEntries(allEntries, selectedStage, 'all');
  const subtabOptions = buildSubtabOptions(selectedStage, stageEntries);
  const selectedSubtab = resolveSubtab(query.subtab, subtabOptions);
  const entries = filterEntries(allEntries, selectedStage, selectedSubtab);
  const selectedEntryId = resolveEntryId(query.entryId, entries);
  const selectedEntry = entries.find((entry) => entry.entryId === selectedEntryId) || entries[0] || null;
  const selectedCard = selectedEntry ? cards.find((card) => card.cardId === selectedEntry.cardId) || null : null;

  return {
    reportId: report && report.reportId ? report.reportId : '',
    reportSummary: report && report.summary ? report.summary : {},
    reportTitle: resolveReportTitle(report),
    selectedStage,
    selectedSubtab,
    selectedCardId: selectedEntry ? selectedEntry.cardId : '',
    selectedEntryId: selectedEntry ? selectedEntry.entryId : '',
    stageTabs: buildStageTabs(allEntries, selectedStage),
    subtabTabs: buildSubtabTabs(subtabOptions, selectedSubtab),
    cards,
    entries,
    selectedCard,
    selectedEntry,
    totalEntries: allEntries.length
  };
}

function resolveReportEmployeeName(report) {
  const user = report && report.user ? report.user : {};
  return firstValue([user.displayName, [user.firstName, user.lastName].filter(Boolean).join(' '), report && report.author, report && report.userName]);
}

function normalizeCards(report) {
  const parsedCards = Array.isArray(report && report.cards) ? report.cards : [];
  const rawCards = Array.isArray(report && report.raw && report.raw.cards) ? report.raw.cards : [];
  const cards = Array.from({ length: Math.max(parsedCards.length, rawCards.length) }, (_, index) => {
    const parsedCard = parsedCards[index] || {};
    const rawCard = rawCards[index] || {};
    const mergedCard = mergeSnapshotEntity(parsedCard, rawCard);
    const parsedEvents = Array.isArray(parsedCard && parsedCard.events) ? parsedCard.events : [];
    const rawEvents = Array.isArray(rawCard && rawCard.events) ? rawCard.events : [];
    mergedCard.events = Array.from(
      { length: Math.max(parsedEvents.length, rawEvents.length) },
      (_, eventIndex) => mergeSnapshotEntity(parsedEvents[eventIndex], rawEvents[eventIndex])
    );
    return mergedCard;
  });

  return cards
    .map((card, index) => normalizeCard(card, index, report))
    .sort((left, right) => {
      const leftStageRank = stageRank(left.stage);
      const rightStageRank = stageRank(right.stage);
      if (leftStageRank !== rightStageRank) {
        return leftStageRank - rightStageRank;
      }

      const leftTime = entryTime(left.latestEntry || { createdAt: left.updatedAt || left.createdAt });
      const rightTime = entryTime(right.latestEntry || { createdAt: right.updatedAt || right.createdAt });
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return left.code.localeCompare(right.code, 'ru');
    });
}

function normalizeCard(card, index, report) {
  const entries = normalizeCardEntries(card, report);
  const latestEntry = entries[0] || null;
  const stage = canonicalizeStage(firstValue(card && [card.stage, card.batchStatus, card.status])) || 'Без стадии';

  return {
    cardId: firstValue(card && [card.cardId]) || `card-${index + 1}`,
    code: firstValue(card && [card.code, card.partyCode, card.partyId, card.id]) || `card-${index + 1}`,
    cultureName: firstVisiblePlantValue(card && [card.cultureName, card.culture, card.crop, card.plant]),
    speciesName: firstVisiblePlantValue(card && [card.speciesName, card.sort, card.grade]),
    varietyName: firstVisiblePlantValue(card && [card.varietyName, card.variety, card.cultivar]),
    stage,
    batchStatus: firstValue(card && [card.batchStatus, card.status, card.partyStatus]),
    sterilityStatus: firstValue(card && [card.sterilityStatus]),
    quantity: firstValue(card && [card.quantity, card.initialCount, card.startCount, card.plannedCount]),
    currentQuantity: firstValue(card && [card.currentQuantity, card.currentCount, card.remainingCount, card.balance]),
    locationDescription: firstValue(card && [card.locationDescription, card.location, card.place, card.position]),
    createdAt: firstValue(card && [card.createdAt, card.date, card.time]),
    updatedAt: firstValue(card && [card.updatedAt]),
    author: firstValue(card && [card.author, card.user, card.userName, report && report.author, report && report.userName]),
    photos: normalizePhotos(card),
    entries,
    latestEntry,
    entryCount: entries.length,
    photoCount: countCardPhotos(card),
    problemCount: entries.filter((entry) => entry.isProblem).length,
    importantCount: entries.filter((entry) => entry.isImportant).length,
    daysInStage: daysInStage(firstValue(card && [card.updatedAt, card.createdAt, card.date])),
    isImportant: Boolean(
      firstValue(card && [card.problem, card.risk]) ||
      firstValue(card && [card.batchStatus, card.status, card.sterilityStatus]).toLowerCase().includes('quarantine') ||
      firstValue(card && [card.sterilityStatus]).toLowerCase().includes('contamin') ||
      entries.some((entry) => entry.isImportant)
    )
  };
}

function normalizeCardEntries(card, report) {
  const events = Array.isArray(card && card.events) ? card.events : [];
  return events
    .map((event, index) => normalizeEntry(card, event, index, report))
    .sort((left, right) => entryTime(right) - entryTime(left));
}

function normalizeReportEntries(cards) {
  return (Array.isArray(cards) ? cards : [])
    .flatMap((card) => Array.isArray(card && card.entries) ? card.entries : normalizeCardEntries(card))
    .sort((left, right) => entryTime(right) - entryTime(left));
}

function normalizeEntry(card, event, index, report) {
  const stage = canonicalizeStage(firstValue(event && [event.stage, card && card.stage, card && card.batchStatus, card && card.status])) || 'Без стадии';
  const cardCode = firstValue(card && [card.code]);
  const cardCulture = [
    firstVisiblePlantValue(card && [card.cultureName, card && card.culture, card && card.crop, card && card.plant]),
    firstVisiblePlantValue(card && [card.speciesName, card && card.sort, card && card.grade]),
    firstVisiblePlantValue(card && [card.varietyName, card && card.variety, card && card.cultivar])
  ]
    .filter(isVisiblePlantPart)
    .join(' · ');
  const reportAuthor = resolveReportEmployeeName(report);
  const reportUserId = firstValue(report && [report.user && report.user.userId]);
  const rawCreatedBy = firstValue(event && [event.createdBy, event.author, event.user, event.userName]);
  const fallbackCreatedBy = firstValue(card && [card.author, card.user, card.userName]) || reportAuthor;

  const entry = {
    entryId: firstValue(event && [event.eventId]) || `${firstValue(card && [card.cardId, card && card.code]) || 'card'}-${index + 1}`,
    cardId: firstValue(card && [card.cardId]),
    cardCode,
    cardCulture,
    cardStage: canonicalizeStage(firstValue(card && [card.stage, card.batchStatus, card.status])),
    cardStatus: firstValue(card && [card.batchStatus, card.status]),
    cardLocationDescription: firstValue(card && [card.locationDescription, card.location, card.place, card.position]),
    cardCurrentQuantity: firstValue(card && [card.currentQuantity, card.quantity]),
    stage,
    createdBy: isUnknownAuthor(rawCreatedBy) || (reportUserId && normalizeText(rawCreatedBy) === normalizeText(reportUserId))
      ? fallbackCreatedBy || 'Неизвестно'
      : rawCreatedBy || fallbackCreatedBy || 'Неизвестно',
    type: firstValue(event && [event.title, event.type, event.eventType, event.name]) || 'Событие',
    date: firstValue(event && [event.createdAt, event.timestamp, event.time, event.date]) || firstValue(card && [card.updatedAt, card.createdAt, card.date]),
    createdAt: firstValue(event && [event.createdAt, event.date, event.time, event.timestamp, card && card.updatedAt, card && card.createdAt, card && card.date]),
    comment: readEventField(event, ['comment', 'message', 'text', 'details']),
    photos: normalizePhotos(event),
    problemType: readEventField(event, ['problemType', 'problem']),
    riskLevel: readEventField(event, ['riskLevel', 'risk']),
    problemDescription: readEventField(event, ['problemDescription', 'diseaseName', 'pestName', 'quarantineReason', 'reason']),
    quantity: firstValue(event && [event.quantity, event.count]),
    count: firstValue(event && [event.count]),
    previousQuantity: firstValue(event && [event.previousQuantity]),
    currentQuantity: firstValue(event && [event.currentQuantity]),
    extraFields: event && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields) ? { ...event.extraFields } : {}
  };

  const delta = numericDelta(entry.previousQuantity, entry.currentQuantity);
  const subtype = classifyJournalSubtype(entry, stage);
  const hasPhotos = entry.photos.length > 0;
  const isProblem = Boolean(entry.problemType || entry.riskLevel || looksProblemLike(entry.type, entry.comment, entry.problemDescription));

  return {
    ...entry,
    subtype,
    hasPhotos,
    photoCount: entry.photos.length,
    delta,
    hasDelta: Number.isFinite(delta),
    isProblem,
    isImportant: isProblem || subtype === 'problems' || subtype === 'losses' || subtype === 'sales',
    timeStamp: entryTime(entry)
  };
}

function classifyJournalSubtype(entry, stage) {
  const haystack = [
    entry.type,
    entry.comment,
    entry.problemDescription,
    entry.problemType,
    entry.riskLevel
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (entry.problemType || entry.riskLevel || entry.problemDescription || looksProblemLike(entry.type, entry.comment, entry.problemType, entry.riskLevel)) {
    return 'problems';
  }

  if (containsAny(haystack, ['списан', 'writeoff', 'loss', 'death', 'discard', 'потер', 'гибель'])) {
    return 'losses';
  }

  if (containsAny(haystack, ['продаж', 'sale', 'sold', 'реализац'])) {
    return 'sales';
  }

  if (containsAny(haystack, ['перемещ', 'transfer', 'move', 'relocat'])) {
    return 'movement';
  }

  if (stage === 'Клонирование') {
    if (containsAny(haystack, ['root', 'укорен'])) return 'rooting';
    if (containsAny(haystack, ['размнож', 'propagat', 'делен'])) return 'propagation';
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (stage === 'Адаптация' || stage === 'Теплица' || stage === 'Закалка') {
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (stage === 'Теплица' && containsAny(haystack, ['пересад', 'transplant'])) {
    return 'transplant';
  }

  if (stage === 'Высадка') {
    if (containsAny(haystack, ['высад', 'plant', 'planting'])) return 'planting';
    if (containsAny(haystack, ['заверш', 'complete', 'finish', 'done'])) return 'completion';
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) {
    return 'observation';
  }

  if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) {
    return 'care';
  }

  return 'all';
}

function buildStageTabs(entries, selectedStage) {
  return STAGE_TABS.map((tab) => ({
    ...tab,
    count: tab.key === 'all'
      ? entries.length
      : tab.key === 'important'
        ? entries.filter((entry) => entry.isImportant).length
        : entries.filter((entry) => sameStage(entry.stage, tab.key)).length,
    active: tab.key === selectedStage
  }));
}

function buildSubtabOptions(selectedStage, entries) {
  const stageKey = selectedStage && STAGE_SUBTABS[selectedStage] ? selectedStage : 'all';
  const keys = STAGE_SUBTABS[stageKey] || STAGE_SUBTABS.all;
  const counts = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    counts.set(entry.subtype, (counts.get(entry.subtype) || 0) + 1);
  }

  return keys.map((key) => ({
    key,
    label: SUBTAB_LABELS[key] || key,
    count: key === 'all' ? (Array.isArray(entries) ? entries.length : 0) : counts.get(key) || 0
  }));
}

function buildSubtabTabs(options, selectedSubtab) {
  return options.map((option) => ({
    ...option,
    active: option.key === selectedSubtab
  }));
}

function filterEntries(entries, selectedStage, selectedSubtab) {
  let filtered = Array.isArray(entries) ? [...entries] : [];

  if (selectedStage && selectedStage !== 'all' && selectedStage !== 'important') {
    filtered = filtered.filter((entry) => sameStage(entry.stage, selectedStage));
  }

  if (selectedStage === 'important') {
    filtered = filtered.filter((entry) => entry.isImportant);
  }

  if (selectedSubtab && selectedSubtab !== 'all') {
    filtered = filtered.filter((entry) => entry.subtype === selectedSubtab);
  }

  return filtered;
}

function resolveStage(value) {
  const normalized = normalizeText(value);
  if (!normalized) return 'all';
  if (normalized === 'important') return 'important';
  if (normalized === 'all') return 'all';
  return canonicalizeStage(value) || 'all';
}

function resolveSubtab(value, options) {
  const normalized = normalizeText(value);
  const match = (options || []).find((option) => normalizeText(option.key) === normalized);
  if (match) return match.key;
  return 'all';
}

function resolveEntryId(value, entries) {
  const normalized = String(value || '').trim();
  if (!normalized) return entries[0] ? entries[0].entryId : '';
  return entries.some((entry) => entry.entryId === normalized) ? normalized : entries[0] ? entries[0].entryId : '';
}

function sameStage(left, right) {
  return normalizeText(canonicalizeStage(left)) === normalizeText(canonicalizeStage(right));
}

function canonicalizeStage(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return STAGE_KEYS.get(normalizeText(text)) || text;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function stageRank(stage) {
  const key = normalizeText(canonicalizeStage(stage));
  return STAGE_PRIORITY.has(key) ? STAGE_PRIORITY.get(key) : Number.POSITIVE_INFINITY;
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function firstVisiblePlantValue(values) {
  const list = Array.isArray(values) ? values : [values];
  return list.find(isVisiblePlantPart) || '';
}

function firstValue(values) {
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function readEventField(event, keys) {
  const extra = event && event.extraFields && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields)
    ? event.extraFields
    : {};
  const list = Array.isArray(keys) ? keys : [keys];
  return firstValue(list.flatMap((key) => [event && event[key], extra[key]]));
}

function containsAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

function looksProblemLike(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return containsAny(text, ['problem', 'risk', 'карантин', 'контамин', 'issue', 'warning']);
}

function normalizePhotos(source) {
  return collectPhotoAliases([
    source && source.photos,
    source && source.photoFiles,
    source && source.photoPath,
    source && source.photoPaths,
    source && source.photoUri,
    source && source.photoUris
  ]);
}

function entryTime(entry) {
  return new Date(entry && (entry.createdAt || entry.date || 0)).getTime() || 0;
}

function numericDelta(previousValue, currentValue) {
  const previous = Number(previousValue);
  const current = Number(currentValue);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return Number.NaN;
  }
  return current - previous;
}

function daysInStage(dateValue) {
  const time = new Date(dateValue || 0).getTime();
  if (!Number.isFinite(time) || !time) {
    return '';
  }
  const delta = Math.max(Date.now() - time, 0);
  return Math.max(Math.floor(delta / 86400000), 0);
}

function countCardPhotos(card) {
  const cardPhotos = normalizePhotos(card).length;
  const eventPhotos = Array.isArray(card && card.events)
    ? card.events.reduce((total, event) => total + normalizePhotos(event).length, 0)
    : 0;
  return cardPhotos + eventPhotos;
}

function collectPhotoAliases(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) {
      result.push(...collectPhotoAliases(value));
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      result.push(value.trim());
      continue;
    }
    if (value && typeof value === 'object') {
      result.push(...collectPhotoAliases([
        value.photoPath,
        value.photoUri,
        value.path,
        value.uri,
        value.photoFiles,
        value.photoPaths,
        value.photoUris
      ]));
    }
  }
  return [...new Set(result)];
}

function mergeSnapshotEntity(parsed, raw) {
  const merged = isPlainObject(parsed) ? { ...parsed } : {};

  for (const [key, value] of Object.entries(isPlainObject(raw) ? raw : {})) {
    if (typeof value === 'string') {
      if (value.trim()) merged[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (hasMeaningfulValue(value)) merged[key] = value;
      continue;
    }
    if (isPlainObject(value)) {
      const nested = mergeSnapshotEntity(isPlainObject(merged[key]) ? merged[key] : {}, value);
      if (Object.keys(nested).length) merged[key] = nested;
      continue;
    }
    if (value !== undefined && value !== null) merged[key] = value;
  }

  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulValue(value) {
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  return value !== undefined && value !== null;
}

const JOURNAL_TITLE = '\u0416\u0443\u0440\u043d\u0430\u043b';

function resolveReportTitle(report) {
  if (!report) {
    return JOURNAL_TITLE;
  }

  const userName = resolveReportEmployeeName(report);
  return userName || report.reportId || JOURNAL_TITLE;
}

module.exports = {
  STAGE_ORDER,
  STAGE_TABS,
  STAGE_SUBTABS,
  SUBTAB_LABELS,
  buildJournalModel,
  buildStageTabs,
  buildSubtabOptions,
  buildSubtabTabs,
  classifyJournalSubtype,
  filterEntries,
  normalizeCards,
  resolveStage,
  resolveSubtab
};

