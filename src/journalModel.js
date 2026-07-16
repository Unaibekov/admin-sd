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

const STAGE_PRIORITY = new Map(STAGE_ORDER.map((label, index) => [label.toLowerCase(), index]));

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

function resolveReportTitle(report) {
  if (!report) {
    return 'Журнал';
  }

  const userName = report.user && (report.user.displayName || [report.user.firstName, report.user.lastName].filter(Boolean).join(' '));
  return userName || report.reportId || 'Журнал';
}

function normalizeCards(report) {
  const cards = Array.isArray(report && report.cards) ? report.cards : [];

  return cards
    .map((card, index) => normalizeCard(card, index))
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

function normalizeCard(card, index) {
  const entries = normalizeCardEntries(card);
  const latestEntry = entries[0] || null;
  const stage = firstValue(card && [card.stage, card.batchStatus, card.status]) || 'Без стадии';

  return {
    cardId: firstValue(card && [card.cardId]) || `card-${index + 1}`,
    code: firstValue(card && [card.code, card.partyCode, card.partyId, card.id]) || `card-${index + 1}`,
    cultureName: firstValue(card && [card.cultureName, card.culture, card.crop, card.plant]),
    speciesName: firstValue(card && [card.speciesName, card.sort, card.grade]),
    varietyName: firstValue(card && [card.varietyName, card.variety, card.cultivar]),
    stage,
    batchStatus: firstValue(card && [card.batchStatus, card.status, card.partyStatus]),
    sterilityStatus: firstValue(card && [card.sterilityStatus]),
    quantity: firstValue(card && [card.quantity, card.initialCount, card.startCount, card.plannedCount]),
    currentQuantity: firstValue(card && [card.currentQuantity, card.currentCount, card.remainingCount, card.balance]),
    locationDescription: firstValue(card && [card.locationDescription, card.location, card.place, card.position]),
    createdAt: firstValue(card && [card.createdAt, card.date, card.time]),
    updatedAt: firstValue(card && [card.updatedAt]),
    author: firstValue(card && [card.author, card.user, card.userName]),
    photos: Array.isArray(card && card.photos) ? card.photos : [],
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

function normalizeCardEntries(card) {
  const events = Array.isArray(card && card.events) ? card.events : [];
  return events
    .map((event, index) => normalizeEntry(card, event, index))
    .sort((left, right) => entryTime(right) - entryTime(left));
}

function normalizeReportEntries(cards) {
  return (Array.isArray(cards) ? cards : [])
    .flatMap((card) => Array.isArray(card && card.entries) ? card.entries : normalizeCardEntries(card))
    .sort((left, right) => entryTime(right) - entryTime(left));
}

function normalizeEntry(card, event, index) {
  const stage = firstValue(event && [event.stage, card && card.stage, card && card.batchStatus, card && card.status]) || 'Без стадии';
  const cardCode = firstValue(card && [card.code]);
  const cardCulture = [firstValue(card && [card.cultureName, card && card.culture, card && card.crop, card && card.plant]), firstValue(card && [card.speciesName, card && card.sort, card && card.grade]), firstValue(card && [card.varietyName, card && card.variety, card && card.cultivar])]
    .filter(Boolean)
    .join(' · ');

  const entry = {
    entryId: firstValue(event && [event.eventId]) || `${firstValue(card && [card.cardId, card && card.code]) || 'card'}-${index + 1}`,
    cardId: firstValue(card && [card.cardId]),
    cardCode,
    cardCulture,
    cardStage: firstValue(card && [card.stage, card.batchStatus, card.status]),
    cardStatus: firstValue(card && [card.batchStatus, card.status]),
    cardLocationDescription: firstValue(card && [card.locationDescription, card.location, card.place, card.position]),
    cardCurrentQuantity: firstValue(card && [card.currentQuantity, card.quantity]),
    stage,
    createdBy: firstValue(event && [event.createdBy, event.author, event.user, event.userName]) || firstValue(card && [card.author, card.user, card.userName]) || 'Неизвестно',
    type: firstValue(event && [event.title, event.type, event.eventType, event.name]) || 'Событие',
    date: firstValue(event && [event.createdAt, event.timestamp, event.time, event.date]) || firstValue(card && [card.updatedAt, card.createdAt, card.date]),
    createdAt: firstValue(event && [event.createdAt, event.date, event.time, event.timestamp, card && card.updatedAt, card && card.createdAt, card && card.date]),
    comment: firstValue(event && [event.comment, event.message, event.text, event.details]),
    photos: normalizePhotos(event),
    problemType: firstValue(event && [event.problemType, event.problem]),
    riskLevel: firstValue(event && [event.riskLevel, event.risk]),
    quantity: firstValue(event && [event.quantity, event.count]),
    count: firstValue(event && [event.count]),
    previousQuantity: firstValue(event && [event.previousQuantity]),
    currentQuantity: firstValue(event && [event.currentQuantity]),
    extraFields: event && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields) ? { ...event.extraFields } : {}
  };

  const delta = numericDelta(entry.previousQuantity, entry.currentQuantity);
  const subtype = classifyJournalSubtype(entry, stage);
  const hasPhotos = entry.photos.length > 0;
  const isProblem = Boolean(entry.problemType || entry.riskLevel || looksProblemLike(entry.type, entry.comment));

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
    entry.problemType,
    entry.riskLevel
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (looksProblemLike(entry.type, entry.comment, entry.problemType, entry.riskLevel)) {
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
  const normalized = String(value || '').trim();
  if (!normalized) return 'all';
  if (normalized === 'important') return 'important';
  if (normalized === 'all') return 'all';
  return STAGE_ORDER.find((stage) => sameStage(stage, normalized)) || 'all';
}

function resolveSubtab(value, options) {
  const normalized = String(value || '').trim();
  const available = new Set((options || []).map((option) => option.key));
  if (available.has(normalized)) return normalized;
  return 'all';
}

function resolveEntryId(value, entries) {
  const normalized = String(value || '').trim();
  if (!normalized) return entries[0] ? entries[0].entryId : '';
  return entries.some((entry) => entry.entryId === normalized) ? normalized : entries[0] ? entries[0].entryId : '';
}

function sameStage(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function stageRank(stage) {
  const key = String(stage || '').trim().toLowerCase();
  return STAGE_PRIORITY.has(key) ? STAGE_PRIORITY.get(key) : Number.POSITIVE_INFINITY;
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

function containsAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

function looksProblemLike(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return containsAny(text, ['problem', 'risk', 'карантин', 'контамин', 'issue', 'warning']);
}

function normalizePhotos(source) {
  const photos = source && Array.isArray(source.photos) ? source.photos : [];
  const photoFiles = source && Array.isArray(source.photoFiles) ? source.photoFiles : [];
  return [...photos, ...photoFiles].filter(Boolean);
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
  const cardPhotos = Array.isArray(card && card.photos) ? card.photos.length : 0;
  const eventPhotos = Array.isArray(card && card.events)
    ? card.events.reduce((total, event) => total + normalizePhotos(event).length, 0)
    : 0;
  return cardPhotos + eventPhotos;
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
