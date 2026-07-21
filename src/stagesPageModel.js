const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const STAGE_LABELS = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage]));

function buildStagesPageModel(reports = [], query = {}) {
  const cards = buildBatchCatalog(reports);
  const search = String(query.q || '').trim();
  const requestedStage = String(query.stage || '').trim();
  const stage = requestedStage === 'all' || STAGE_ORDER.includes(requestedStage) ? (requestedStage || 'all') : 'all';
  const filteredCards = cards.filter((card) => {
    const matchesStage = !stage || stage === 'all' || card.stage === stage;
    const matchesSearch = !search || card.searchText.includes(search.toLowerCase());
    return matchesStage && matchesSearch;
  });
  const requestedBatchKey = String(query.batchId || '').trim();
  const requestedCardId = String(query.cardId || '').trim();
  const selectedTab = ['calendar', 'passport', 'journal'].includes(String(query.tab || '').trim())
    ? String(query.tab).trim()
    : 'calendar';
  const highlightedEventId = String(query.eventId || '').trim();
  const selectedCard = filteredCards.find((card) => card.batchKey === requestedBatchKey)
    || (!requestedBatchKey && filteredCards.find((card) => card.cardId === requestedCardId))
    || null;

  return {
    pageTitle: 'Партии',
    search,
    selectedStage: stage || 'all',
    selectedCardId: selectedCard ? selectedCard.cardId : '',
    selectedBatchKey: selectedCard ? selectedCard.batchKey : '',
    selectedTab,
    highlightedEventId,
    cards: filteredCards,
    selectedCard,
    stages: [
      { key: 'all', label: 'Все партии', count: cards.length },
      ...STAGE_ORDER.map((key) => ({
        key,
        label: STAGE_LABELS[key],
        count: cards.filter((card) => card.stage === key).length
      }))
    ]
  };
}

function buildBatchCatalog(reports) {
  const byKey = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    const rawCards = Array.isArray(report && report.raw && report.raw.cards)
      ? report.raw.cards
      : Array.isArray(report && report.cards) ? report.cards : [];
    rawCards.forEach((rawCard, index) => {
      const parsedCard = report.cards && report.cards[index] ? report.cards[index] : {};
      const cardId = String(rawCard.cardId || parsedCard.cardId || rawCard.code || parsedCard.code || `${report.reportId}-${index + 1}`);
      const normalized = normalizeCard(rawCard, parsedCard, report, index);
      const existing = byKey.get(normalized.batchKey);
      if (!existing || normalized.snapshotAt >= existing.snapshotAt) {
        byKey.set(normalized.batchKey, {
          ...(existing || {}),
          ...normalized,
          events: deduplicateEvents([...(existing ? existing.events : []), ...normalized.events])
        });
      } else {
        existing.events = deduplicateEvents([...existing.events, ...normalized.events]);
      }
    });
  }
  return [...byKey.values()]
    .map((card) => ({ ...card, events: card.events.sort((a, b) => eventTime(b) - eventTime(a)) }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

function normalizeCard(raw, parsed, report, index) {
  const titleParts = [raw.cultureName || parsed.culture, raw.speciesName, raw.varietyName || parsed.variety || parsed.sort].filter(isVisiblePlantPart);
  const events = Array.isArray(raw.events) ? raw.events : Array.isArray(parsed.events) ? parsed.events : [];
  const snapshotAt = resolveSnapshotAt(raw, parsed, report, events);
  const currentQuantity = raw.currentQuantity ?? raw.currentCount ?? raw.remainingCount ?? parsed.currentCount ?? raw.quantity ?? parsed.initialCount;
  const initialQuantity = raw.initialQuantity ?? raw.initialCount ?? raw.quantity ?? parsed.initialCount;
  const stage = String(raw.stage || parsed.stage || '').trim() || 'Без стадии';
  const status = String(raw.batchStatus || raw.status || parsed.status || 'Не указан').trim();
  const sterilityStatus = String(raw.sterilityStatus || parsed.sterilityStatus || '').trim();
  const location = raw.locationDescription || raw.location || raw.place || parsed.location || '';
  const problemType = raw.problemType || raw.problem || parsed.problemType || parsed.problem || '';
  const riskLevel = raw.riskLevel || raw.risk || parsed.riskLevel || parsed.risk || '';
  const activeProblemQuantity = raw.activeProblemQuantity ?? parsed.activeProblemQuantity ?? '';
  const healthyQuantity = raw.healthyQuantity ?? parsed.healthyQuantity ?? '';
  const originType = raw.originType || parsed.originType || '';
  const parentCardId = raw.parentCardId || parsed.parentCardId || '';
  const parentCode = raw.parentCode || parsed.parentCode || '';
  const sourceEventId = raw.sourceEventId || parsed.sourceEventId || '';
  const generation = raw.generation ?? parsed.generation ?? '';
  const propagatedAt = raw.propagatedAt || parsed.propagatedAt || '';
  const propagationMethod = raw.propagationMethod || parsed.propagationMethod || '';
  const code = String(raw.code || parsed.code || `card-${index + 1}`);
  const cardId = String(raw.cardId || parsed.cardId || code);
  const deviceId = String(report.deviceId || '').trim();
  const batchKey = buildBatchKey(deviceId, cardId, report.reportId);
  const eventList = events.map((event) => normalizeEvent(event, report.reportId));

  return {
    cardId,
    batchKey,
    deviceId,
    code,
    title: titleParts.length ? titleParts.join(' · ') : code,
    culture: isVisiblePlantPart(raw.cultureName || parsed.culture) ? raw.cultureName || parsed.culture : '',
    species: isVisiblePlantPart(raw.speciesName) ? raw.speciesName : '',
    variety: isVisiblePlantPart(raw.varietyName || parsed.variety || parsed.sort) ? raw.varietyName || parsed.variety || parsed.sort : '',
    stage,
    status,
    sterilityStatus,
    problemType,
    riskLevel,
    activeProblemQuantity,
    healthyQuantity,
    originType,
    parentCardId,
    parentCode,
    sourceEventId,
    generation,
    propagatedAt,
    propagationMethod,
    cancelledAt: raw.cancelledAt || '',
    currentQuantity,
    initialQuantity,
    location,
    createdAt: raw.createdAt || report.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt || report.createdAt,
    snapshotAt,
    reportId: report.reportId,
    events: eventList,
    photoFiles: uniqueStrings([...(raw.photoFiles || []), ...(raw.photos || [])]),
    searchText: [cardId, code, deviceId, ...titleParts, stage, status, location, originType, parentCode, propagationMethod].join(' ').toLowerCase()
  };
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function buildBatchKey(deviceId, cardId, reportId) {
  const source = deviceId || `report:${String(reportId || 'unknown-report').trim()}`;
  // The key is placed in the URL as batchId, so it must not contain control characters.
  return `${source}::${String(cardId || '').trim()}`.toLowerCase();
}

function normalizeEvent(event, reportId) {
  const photos = uniqueStrings([...(event.photoFiles || []), ...(event.photos || []), ...(event.photoPaths || [])]);
  const extraFields = event.extraFields && typeof event.extraFields === 'object' ? event.extraFields : {};
  return {
    eventId: String(event.eventId || `${reportId}-${event.createdAt || event.date || event.type}`),
    title: String(event.title || event.type || 'Событие'),
    type: String(event.type || ''),
    createdAt: event.createdAt || event.date || event.timestamp || '',
    count: event.currentQuantity ?? event.count ?? event.quantity ?? '',
    previousQuantity: event.previousQuantity ?? '',
    currentQuantity: event.currentQuantity ?? '',
    quantity: event.quantity ?? event.count ?? '',
    propagationMethod: event.propagationMethod || extraFields.propagationMethod || '',
    childCardId: event.childCardId || extraFields.childCardId || '',
    childCode: event.childCode || extraFields.childCode || '',
    parentCardId: event.parentCardId || extraFields.parentCardId || '',
    parentCode: event.parentCode || extraFields.parentCode || '',
    sourceEventId: event.sourceEventId || extraFields.sourceEventId || '',
    generation: event.generation ?? extraFields.generation ?? '',
    diseaseName: event.diseaseName || extraFields.diseaseName || '',
    pestName: event.pestName || extraFields.pestName || '',
    diseaseSeverity: event.diseaseSeverity || extraFields.diseaseSeverity || '',
    affectedQuantity: event.affectedQuantity ?? extraFields.affectedQuantity ?? '',
    recoveredQuantity: event.recoveredQuantity ?? extraFields.recoveredQuantity ?? '',
    comment: event.comment || event.message || '',
    extraFields,
    photos
  };
}

function deduplicateEvents(events) {
  const seen = new Map();
  for (const event of events) {
    if (!seen.has(event.eventId)) seen.set(event.eventId, event);
  }
  return [...seen.values()];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()))];
}

function resolveSnapshotAt(raw, parsed, report, events) {
  const candidates = [
    raw && raw.updatedAt,
    raw && raw.createdAt,
    parsed && parsed.date,
    report && report.createdAt,
    ...events.map((event) => event && (event.createdAt || event.date || event.timestamp))
  ].map(eventTime);

  return candidates.reduce((latest, value) => Math.max(latest, value), 0);
}

function eventTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value) {
  const time = eventTime(value);
  return time ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(time)) : '—';
}

module.exports = { buildStagesPageModel, buildBatchCatalog, deduplicateEvents, STAGE_ORDER, STAGE_LABELS, formatDate };
