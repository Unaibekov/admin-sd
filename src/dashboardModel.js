const { buildBatchCatalog } = require('./stagesPageModel');

const PERIOD_OPTIONS = [
  ['today', 'Сегодня'],
  ['7d', '7 дней'],
  ['30d', '30 дней'],
  ['all', 'Все время']
];
const STAGE_ORDER = ['Введение в культуру', 'Клонирование', 'Адаптация', 'Теплица', 'Закалка', 'Высадка'];
const LOSS_TYPES = new Set(['loss', 'introloss', 'death', 'discard', 'writeoff']);
const AUTOMATIC_TYPES = new Set(['batchcreated', 'qrgenerated', 'stagesettingsupdated']);
const REPORT_USER_ALIASES = ['local-user'];
const UNKNOWN_AUTHOR_VALUES = new Set(['неизвестно', 'unknown', 'unknown-user']);
const DISPLAY_TIME_ZONE = 'Europe/Moscow';

function buildFlashMessage(query) {
  const parts = [];
  if (String(query.cleared || '') === '1') parts.push('Отчеты очищены.');

  const uploaded = Number(query.uploaded || 0);
  const failed = Number(query.failed || 0);
  if (uploaded > 0 || failed > 0) {
    parts.push(`Загружено отчетов: ${uploaded}.`);
    if (failed > 0) parts.push(`Не удалось обработать: ${failed}.`);
  }
  return parts.join(' ');
}

function buildDashboard(reports = [], selectedReport = null, reportModels = [], query = {}) {
  const sourceReports = reportModels.length ? reportModels : selectedReport ? [selectedReport] : [];
  const period = resolvePeriod(query.period);
  const batches = getLatestBatchSnapshots(sourceReports);
  const events = buildUniqueEventIndex(sourceReports, batches);
  const periodEvents = events.filter((event) => isInPeriod(event.timestamp, period));
  const periodReports = sourceReports.filter((report) => isInPeriod(toTimestamp(report.createdAt), period));
  const attentionBatches = getAttentionBatches(batches, events);
  const current = getCurrentMetrics(batches, attentionBatches);
  const employeeActivity = getEmployeeActivity(sourceReports, periodEvents, periodReports);
  const recentPhotos = getRecentPhotos(periodEvents);
  const productionMetrics = getProductionMetrics(periodEvents);
  const recentEvents = periodEvents.filter(isUserInitiatedEvent).sort(byNewest);
  const journalBaseQuery = buildJournalQuery(period, query);

  const dashboard = {
    hasReports: reports.length > 0,
    hasCards: batches.length > 0,
    reportsCount: reports.length,
    period,
    periodOptions: PERIOD_OPTIONS.map(([value, label]) => ({ value, label })),
    topMetrics: [
      { key: 'active', label: 'Активные партии', note: 'Сейчас в работе', value: current.activeBatches, tone: 'dark' },
      { key: 'attention', label: 'Требуют внимания', note: 'Проблемы и риски', value: attentionBatches.length, tone: 'warning', href: '/journal?category=problems' },
      { key: 'quarantine', label: 'В карантине', note: 'Изолированные партии', value: current.quarantineBatches, tone: 'accent', href: '/journal?category=problems' },
      { key: 'losses', label: 'Потери', note: 'За выбранный период', value: productionMetrics.losses ? productionMetrics.losses.value : 0, tone: 'danger' },
      { key: 'employees', label: 'Сотрудники', note: 'Работали за период', value: employeeActivity.length, tone: 'success' }
    ],
    recentEvents,
    recentEventsEmpty: periodEvents.length === 0,
    chartTabs: {
      stages: buildDistributionChart(batches, 'stages'),
      cultures: buildDistributionChart(batches, 'cultures')
    },
    attentionBatches: attentionBatches.slice(0, 5),
    employeeActivity: employeeActivity.slice(0, 5),
    recentReports: periodReports.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt)).slice(0, 5).map(buildRecentReport),
    recentPhotos: recentPhotos.slice(0, 12),
    productionMetrics,
    current,
    cardsCount: batches.length,
    problemsCount: attentionBatches.length,
    quarantineCount: current.quarantineBatches,
    lossCount: productionMetrics.losses ? productionMetrics.losses.value : 0
  };
  dashboard.topMetrics = dashboard.topMetrics.map((metric) => ({
    ...metric,
    href: resolveTopMetricHref(metric, journalBaseQuery)
  }));
  return dashboard;
}

function resolveTopMetricHref(metric, baseQuery) {
  if (!metric || !metric.key) return metric && metric.href ? metric.href : '';
  if (metric.key === 'active') return '/stages';
  if (metric.key === 'attention') return buildJournalHref(baseQuery, { category: 'problems', quick: 'important' });
  if (metric.key === 'quarantine') return buildJournalHref(baseQuery, { category: 'problems', quick: 'quarantine' });
  if (metric.key === 'losses') return buildJournalHref(baseQuery, { category: 'losses' });
  return metric.href || '';
}

function buildJournalQuery(period, query = {}) {
  const params = {};
  if (period && period.key && period.key !== 'all') params.period = period.key;
  if (period && period.key === 'custom') {
    const dateFrom = String(query.dateFrom || '').trim();
    const dateTo = String(query.dateTo || '').trim();
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
  }
  return params;
}

function buildJournalHref(baseQuery = {}, extraQuery = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...baseQuery, ...extraQuery }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `/journal?${query}` : '/journal';
}

function getLatestBatchSnapshots(reports = []) {
  return buildBatchCatalog(reports).map((batch) => ({
    ...batch,
    status: normalizeStatus(batch.status),
    sterilityStatus: String(batch.sterilityStatus || '').trim().toLowerCase(),
    cancelledAt: batch.cancelledAt || ''
  }));
}

function buildUniqueEventIndex(reports = [], batches = []) {
  const batchByKey = new Map(batches.map((batch) => [batch.batchKey, batch]));
  const employeeDirectory = buildEmployeeDirectory(reports);
  const events = new Map();

  for (const report of reports) {
    const rawCards = Array.isArray(report && report.raw && report.raw.cards) && report.raw.cards.length
      ? report.raw.cards
      : Array.isArray(report && report.cards) ? report.cards : [];
    rawCards.forEach((card, cardIndex) => {
      const cardId = String(card && (card.cardId || card.code) || `${report.reportId}-${cardIndex + 1}`);
      const batchKey = buildBatchKey(report, cardId);
      const batch = batchByKey.get(batchKey);
      for (const rawEvent of Array.isArray(card && card.events) ? card.events : []) {
        const event = normalizeDashboardEvent(rawEvent, card, report, batch, employeeDirectory);
        const existing = events.get(event.key);
        if (!existing || event.snapshotAt >= existing.snapshotAt) events.set(event.key, event);
      }
    });
  }

  return [...events.values()];
}

function normalizeDashboardEvent(rawEvent = {}, rawCard = {}, report = {}, batch = null, employeeDirectory = new Map()) {
  const type = normalizeType(rawEvent.type || rawEvent.eventType || rawEvent.name);
  const date = firstValue(rawEvent.createdAt, rawEvent.timestamp, rawEvent.time, rawEvent.date);
  const rawCreatedById = firstValue(rawEvent.createdBy, rawEvent.author, rawEvent.user, rawEvent.userName);
  const createdById = isUnknownAuthor(rawCreatedById) ? firstValue(report.user && report.user.userId) : rawCreatedById || firstValue(report.user && report.user.userId);
  const createdBy = employeeDirectory.get(normalizeText(createdById)) || createdById || 'Неизвестно';
  const cardId = String(rawCard.cardId || rawCard.code || batch && batch.cardId || '');
  const eventId = String(rawEvent.eventId || '').trim();
  const key = eventId
    ? `id:${eventId}`
    : `fallback:${buildBatchKey(report, cardId)}|${type}|${date}|${normalizeText(createdById)}|${firstValue(rawEvent.count, rawEvent.quantity)}|${firstValue(rawEvent.comment, rawEvent.message)}`;
  const photoFiles = uniqueStrings([
    ...toArray(rawEvent.photos), ...toArray(rawEvent.photoFiles), ...toArray(rawEvent.photoPaths),
    rawEvent.photoUri, ...toArray(rawEvent.photoUris)
  ]);
  const getPhotoUrl = typeof report.getPhotoUrl === 'function' ? report.getPhotoUrl.bind(report) : () => '';
  const previewPhoto = photoFiles.map((path) => getPhotoUrl(path)).find(Boolean) || '';
  const risk = firstValue(rawEvent.riskLevel, rawEvent.risk, rawEvent.extraFields && rawEvent.extraFields.riskLevel);
  const problem = firstValue(rawEvent.problemType, rawEvent.problem, rawEvent.extraFields && rawEvent.extraFields.problemType);
  const title = type === 'problem' && normalizeText(problem) === normalizeText('Карантин')
    ? 'Карантин'
    : firstValue(rawEvent.title) || formatEventTitle(type);
  const problemDescription = firstValue(rawEvent.problemDescription, rawEvent.extraFields && rawEvent.extraFields.problemDescription, rawEvent.diseaseName, rawEvent.pestName, rawEvent.extraFields && rawEvent.extraFields.diseaseName, rawEvent.extraFields && rawEvent.extraFields.pestName);
  const reason = firstValue(rawEvent.reason, rawEvent.lossReason, rawEvent.extraFields && rawEvent.extraFields.reason, rawEvent.extraFields && rawEvent.extraFields.lossReason);
  const location = firstValue(rawEvent.nextLocation, rawEvent.locationDescription, rawEvent.location, rawEvent.extraFields && rawEvent.extraFields.nextLocation, rawEvent.extraFields && rawEvent.extraFields.locationDescription, rawEvent.extraFields && rawEvent.extraFields.location);
  const fromStage = firstValue(rawEvent.fromStage, rawEvent.extraFields && rawEvent.extraFields.fromStage);
  const toStage = firstValue(rawEvent.toStage, rawEvent.extraFields && rawEvent.extraFields.toStage);
  const propagationMethod = firstValue(rawEvent.propagationMethod, rawEvent.extraFields && rawEvent.extraFields.propagationMethod);
  const saleType = firstValue(rawEvent.saleType, rawEvent.extraFields && rawEvent.extraFields.saleType);
  const recipient = firstValue(rawEvent.recipient, rawEvent.extraFields && rawEvent.extraFields.recipient);
  const saleAmount = firstValue(rawEvent.saleAmount, rawEvent.amount, rawEvent.price, rawEvent.extraFields && rawEvent.extraFields.saleAmount, rawEvent.extraFields && rawEvent.extraFields.amount, rawEvent.extraFields && rawEvent.extraFields.price);
  const careType = firstValue(rawEvent.careType, rawEvent.extraFields && rawEvent.extraFields.careType);
  const productName = firstValue(rawEvent.productName, rawEvent.extraFields && rawEvent.extraFields.productName);
  const dosage = firstValue(rawEvent.dosage, rawEvent.extraFields && rawEvent.extraFields.dosage);
  const applicationMethod = firstValue(rawEvent.applicationMethod, rawEvent.extraFields && rawEvent.extraFields.applicationMethod);
  const plantReaction = firstValue(rawEvent.plantReaction, rawEvent.extraFields && rawEvent.extraFields.plantReaction);
  const stressLevel = firstValue(rawEvent.stressLevel, rawEvent.extraFields && rawEvent.extraFields.stressLevel);
  const turgor = firstValue(rawEvent.turgor, rawEvent.extraFields && rawEvent.extraFields.turgor);
  const placement = firstValue(rawEvent.placement, rawEvent.extraFields && rawEvent.extraFields.placement);
  const densityChange = firstValue(rawEvent.densityChange, rawEvent.extraFields && rawEvent.extraFields.densityChange);
  const completionResult = firstValue(rawEvent.completionResult, rawEvent.extraFields && rawEvent.extraFields.completionResult);
  const plantingLocation = firstValue(rawEvent.plantingLocation, rawEvent.extraFields && rawEvent.extraFields.plantingLocation);
  const plantingScheme = firstValue(rawEvent.plantingScheme, rawEvent.extraFields && rawEvent.extraFields.plantingScheme);
  const plotArea = firstValue(rawEvent.plotArea, rawEvent.extraFields && rawEvent.extraFields.plotArea);
  const soilType = firstValue(rawEvent.soilType, rawEvent.extraFields && rawEvent.extraFields.soilType);

  return {
    key,
    eventId,
    batchKey: buildBatchKey(report, cardId),
    cardId,
    code: batch && batch.code || rawCard.code || cardId || 'Без кода',
    culture: batch && batch.title || [rawCard.cultureName, rawCard.speciesName, rawCard.varietyName].filter(isVisiblePlantPart).join(' · ') || rawCard.code || 'Партия без названия',
    stage: firstValue(rawEvent.stage, batch && batch.stage, rawCard.stage) || 'Без стадии',
    type,
    title,
    date,
    timestamp: toTimestamp(date),
    snapshotAt: toTimestamp(firstValue(report.createdAt, rawCard.updatedAt, date)),
    createdBy,
    createdById,
    role: employeeDirectory.get(`${normalizeText(createdById)}:role`) || report.user && report.user.role || '',
    quantity: getQuantity(rawEvent),
    previousQuantity: getPositiveQuantity(rawEvent.previousQuantity),
    currentQuantity: getPositiveQuantity(rawEvent.currentQuantity),
    totalQuantity: getPositiveQuantity(firstValue(rawEvent.totalQuantity, rawEvent.extraFields && rawEvent.extraFields.totalQuantity, rawCard.quantity, rawCard.currentQuantity)),
    risk,
    problem,
    problemDescription,
    reason,
    location,
    fromStage,
    toStage,
    propagationMethod,
    saleType,
    recipient,
    saleAmount,
    careType,
    productName,
    dosage,
    applicationMethod,
    plantReaction,
    stressLevel,
    turgor,
    placement,
    densityChange,
    completionResult,
    plantingLocation,
    plantingScheme,
    plotArea,
    soilType,
    comment: firstValue(rawEvent.comment, rawEvent.message, rawEvent.text, rawEvent.details),
    photoFiles,
    previewPhoto,
    reportId: report.reportId,
    getPhotoUrl,
    raw: rawEvent
  };
}

function getAttentionBatches(batches = [], events = []) {
  const byBatch = new Map();
  for (const event of events) {
    if (!isProblemEvent(event)) continue;
    const list = byBatch.get(event.batchKey) || [];
    list.push(event);
    byBatch.set(event.batchKey, list);
  }

  return batches.map((batch) => {
    const problemEvents = (byBatch.get(batch.batchKey) || []).sort(byNewest);
    const latestProblem = problemEvents[0] || null;
    const risk = normalizeRisk(latestProblem && latestProblem.risk || batch.riskLevel || batch.risk || '');
    const status = normalizeStatus(batch.status);
    const contaminated = String(batch.sterilityStatus || '').toLowerCase().includes('contamin');
    const hasHighRisk = risk === 'critical' || risk === 'high';
    const needsAttention = status === 'problem' || status === 'quarantine' || contaminated || hasHighRisk;
    if (!needsAttention) return null;

    const reason = status === 'quarantine'
      ? 'Карантин'
      : contaminated
        ? 'Контаминация'
        : latestProblem && (latestProblem.problem || latestProblem.title)
          ? latestProblem.problem || latestProblem.title
          : status === 'problem' ? 'Требует внимания' : 'Высокий риск';
    const priority = risk === 'critical' ? 0 : status === 'quarantine' ? 1 : risk === 'high' ? 2 : contaminated ? 3 : 4;
    const problemAt = latestProblem ? latestProblem.timestamp : toTimestamp(batch.updatedAt);

    return {
      ...batch,
      reason,
      risk: risk ? formatRisk(risk) : 'Не указан',
      riskKey: risk,
      latestProblemAt: problemAt,
      latestProblemTitle: latestProblem && latestProblem.title ? latestProblem.title : reason,
      latestProblemAuthor: latestProblem && latestProblem.createdBy ? latestProblem.createdBy : 'Автор не указан',
      latestProblemEvent: latestProblem ? { ...latestProblem, title: latestProblem.title || reason } : null,
      latestProblemLabel: formatDateTime(problemAt),
      daysWithoutUpdate: problemAt ? Math.max(0, Math.floor((Date.now() - problemAt) / 86400000)) : null,
      priority,
      statusLabel: formatStatus(status)
    };
  }).filter(Boolean).sort((left, right) => left.priority - right.priority || right.latestProblemAt - left.latestProblemAt);
}

function getEmployeeActivity(reports = [], events = [], periodReports = []) {
  const directory = buildEmployeeDirectory(reports);
  const activity = new Map();
  const get = (name, role = '') => {
    const key = normalizeText(name) || 'unknown';
    if (!activity.has(key)) activity.set(key, { name: name || 'Неизвестно', role, reportsCount: 0, eventCount: 0, batches: new Set(), lastActivityAt: 0 });
    return activity.get(key);
  };

  for (const report of periodReports) {
    const profile = report.user || {};
    const name = firstValue(profile.displayName, [profile.firstName, profile.lastName].filter(Boolean).join(' '), report.author) || 'Неизвестно';
    const entry = get(name, profile.role || '');
    entry.reportsCount += 1;
    entry.lastActivityAt = Math.max(entry.lastActivityAt, toTimestamp(report.createdAt));
  }
  for (const event of events) {
    const name = event.createdBy || directory.get(normalizeText(event.createdById)) || 'Неизвестно';
    const entry = get(name, event.role || '');
    entry.eventCount += 1;
    entry.batches.add(event.batchKey);
    entry.lastActivityAt = Math.max(entry.lastActivityAt, event.timestamp);
  }

  return [...activity.values()].map((entry) => ({
    ...entry,
    batchesCount: entry.batches.size,
    lastActivityLabel: formatDateTime(entry.lastActivityAt)
  })).sort((left, right) => right.eventCount - left.eventCount || right.reportsCount - left.reportsCount || right.lastActivityAt - left.lastActivityAt);
}

function getRecentPhotos(events = []) {
  const photos = new Map();
  for (const event of events) {
    for (const path of event.photoFiles) {
      const url = event.getPhotoUrl(path);
      if (!url) continue;
      const key = `${event.key}|${path}`;
      if (!photos.has(key)) {
        photos.set(key, {
          key,
          url,
          label: `${event.code} · ${event.title}`,
          code: event.code,
          eventTitle: event.title,
          createdBy: event.createdBy,
          timestamp: event.timestamp,
          dateLabel: formatDateTime(event.timestamp)
        });
      }
    }
  }
  return [...photos.values()].sort(byNewest);
}

function getProductionMetrics(events = []) {
  const definitions = [
    ['sales', 'Продано', new Set(['sale'])],
    ['losses', 'Потери', LOSS_TYPES],
    ['propagation', 'Размножено', new Set(['propagation'])],
    ['planting', 'Высажено', new Set(['planting'])]
  ];
  const metrics = {};
  for (const [key, label, types] of definitions) {
    const matching = events.filter((event) => types.has(event.type) && event.quantity > 0);
    if (matching.length) metrics[key] = { key, label, value: matching.reduce((total, event) => total + event.quantity, 0), unit: 'шт.' };
  }
  return metrics;
}

function getCurrentMetrics(batches, attentionBatches) {
  const activeBatches = batches.filter((batch) => isWorkingStatus(batch.status)).length;
  const quarantineBatches = batches.filter((batch) => normalizeStatus(batch.status) === 'quarantine').length;
  return { activeBatches, quarantineBatches, attentionBatches: attentionBatches.length, totalBatches: batches.length };
}

// Kept for the existing dashboard tests and consumers that only need an all-time snapshot.
function buildCurrentDashboardSnapshot(reports = []) {
  const cards = getLatestBatchSnapshots(reports);
  const events = buildUniqueEventIndex(reports, cards);
  const production = getProductionMetrics(events);
  return {
    cards,
    cardsCount: cards.length,
    problemCount: cards.filter((card) => normalizeStatus(card.status) === 'problem').length,
    quarantineCount: cards.filter((card) => normalizeStatus(card.status) === 'quarantine').length,
    lostPlants: production.losses ? production.losses.value : 0,
    soldPlants: production.sales ? production.sales.value : 0
  };
}

function buildDistributionChart(batches = [], mode) {
  const counts = new Map();
  for (const batch of batches) {
    const label = mode === 'stages' ? batch.stage || 'Без стадии' : batch.culture || 'Без культуры';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let entries = [...counts.entries()];
  if (mode === 'stages') {
    entries.sort((left, right) => stageRank(left[0]) - stageRank(right[0]) || left[0].localeCompare(right[0], 'ru'));
  } else {
    entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'));
    if (entries.length > 7) {
      const visible = entries.slice(0, 6);
      visible.push(['Другие', entries.slice(6).reduce((total, entry) => total + entry[1], 0)]);
      entries = visible;
    }
  }

  const palette = ['#2f855a', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];
  const total = batches.length;
  let cursor = 0;
  const legend = entries.map(([label, value], index) => {
    const share = total ? (value / total) * 100 : 0;
    const item = { label, value, share, color: palette[index % palette.length], start: cursor, end: cursor + share };
    cursor += share;
    return item;
  });
  return {
    total,
    totalLabel: 'партий',
    legend,
    chartBackground: legend.length ? `conic-gradient(${legend.map((item) => `${item.color} ${item.start.toFixed(2)}% ${item.end.toFixed(2)}%`).join(', ')})` : 'conic-gradient(#e5e7eb 0 100%)'
  };
}

function buildRecentReport(report) {
  const summary = report.summary || {};
  const user = report.user || {};
  return {
    reportId: report.reportId,
    author: firstValue(user.displayName, [user.firstName, user.lastName].filter(Boolean).join(' '), report.author) || 'Автор не указан',
    role: user.role || 'Роль не указана',
    displayCreatedAt: report.displayCreatedAt || formatDateTime(toTimestamp(report.createdAt)),
    summary: {
      cardsCount: Number(summary.cardsCount) || 0,
      eventsCount: Number(summary.eventsCount) || 0,
      photosCount: Number(summary.photosCount) || 0,
      problemsCount: Number(summary.problemCount ?? summary.problemsCount) || 0
    }
  };
}

function resolvePeriod(value) {
  const key = PERIOD_OPTIONS.some(([period]) => period === value) ? value : '7d';
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = key === 'today' ? today : key === '7d' ? today - 6 * 86400000 : key === '30d' ? today - 29 * 86400000 : 0;
  return { key, start, label: PERIOD_OPTIONS.find(([period]) => period === key)[1] };
}

function isInPeriod(timestamp, period) {
  return period.key === 'all' ? Boolean(timestamp) : timestamp >= period.start;
}

function isUserInitiatedEvent(event) {
  return !AUTOMATIC_TYPES.has(event.type);
}

function isProblemEvent(event) {
  return ['problem', 'contamination', 'quarantine', 'greenhousedisease'].includes(event.type)
    || Boolean(event.problem || event.risk);
}

function isWorkingStatus(status) {
  return !['sold', 'archived', 'cancelled', 'completed'].includes(normalizeStatus(status));
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/[\s_-]+/g, '');
}

function normalizeRisk(value) {
  const text = normalizeText(value);
  if (text.includes('крит') || text.includes('critical')) return 'critical';
  if (text.includes('высок') || text.includes('high')) return 'high';
  if (text.includes('сред') || text.includes('medium')) return 'medium';
  if (text.includes('низ') || text.includes('low')) return 'low';
  return '';
}

function formatRisk(value) {
  return ({ critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' })[value] || 'Не указан';
}

function formatStatus(value) {
  return ({ active: 'Активна', partial: 'Частично', problem: 'Проблема', quarantine: 'Карантин', sold: 'Продана', archived: 'Архив' })[value] || 'Не указан';
}

function formatEventTitle(type) {
  return ({ problem: 'Проблема', contamination: 'Контаминация', quarantine: 'Карантин', sale: 'Продажа', introloss: 'Потери', loss: 'Потери', death: 'Гибель', discard: 'Списание', propagation: 'Размножение', planting: 'Высадка', stagechange: 'Изменение стадии', movement: 'Перемещение', greenhousedisease: 'Болезнь', greenhousecare: 'Уход', adaptationcare: 'Уход', hardeningcare: 'Уход', plantingcare: 'Уход' })[type] || 'Событие';
}

function buildEmployeeDirectory(reports) {
  const directory = new Map();
  for (const report of reports) {
    const user = report.user || {};
    const name = firstValue(user.displayName, [user.firstName, user.lastName].filter(Boolean).join(' '));
    for (const id of [user.userId, report.author, report.userName, ...REPORT_USER_ALIASES]) {
      if (id && name) {
        directory.set(normalizeText(id), name);
        directory.set(`${normalizeText(id)}:role`, user.role || '');
      }
    }
  }
  return directory;
}

function buildBatchKey(report, cardId) {
  return `${String(report && report.deviceId || report && report.reportId || 'unknown').trim()}::${String(cardId || '').trim()}`.toLowerCase();
}

function getQuantity(event) {
  const value = Number(event && (event.count ?? event.quantity ?? 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getPositiveQuantity(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeType(value) {
  return String(value || '').toLowerCase().replace(/[^a-zа-яё]/g, '');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isUnknownAuthor(value) {
  return UNKNOWN_AUTHOR_VALUES.has(normalizeText(value));
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateTime(timestamp) {
  if (!timestamp) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIME_ZONE }).format(new Date(timestamp));
}

function stageRank(value) {
  const index = STAGE_ORDER.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function byNewest(left, right) {
  return right.timestamp - left.timestamp;
}

module.exports = {
  buildDashboard,
  buildDashboardModel: buildDashboard,
  buildFlashMessage,
  getLatestBatchSnapshots,
  buildUniqueEventIndex,
  getAttentionBatches,
  getEmployeeActivity,
  getProductionMetrics,
  getRecentPhotos,
  resolvePeriod,
  buildCurrentDashboardSnapshot
};
