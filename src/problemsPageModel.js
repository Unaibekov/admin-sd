const { buildBatchCatalog } = require('./stagesPageModel');

const STATUS_DEFINITIONS = [
  ['active', 'Активные'],
  ['isolated', 'В изоляции'],
  ['resolved', 'Решенные'],
  ['all', 'Все']
];

const STATUS_KEYS = new Map(STATUS_DEFINITIONS.map(([value]) => [normalizeText(value), value]));
const RISK_ORDER = ['critical', 'high', 'medium', 'low', 'none'];
const RISK_INDEX = new Map(RISK_ORDER.map((value, index) => [value, index]));

function buildProblemsPageModel(reports = [], query = {}) {
  const batches = buildBatchCatalog(reports);
  const problemCases = attachProblemRelations(batches)
    .map((batch) => buildProblemCase(batch))
    .filter(Boolean);

  const filters = resolveFilters(query, problemCases);
  const filteredCases = problemCases.filter((problemCase) => matchesBaseFilters(problemCase, filters));
  const counts = countProblemCases(filteredCases);
  const visibleCases = filteredCases
    .filter((problemCase) => matchesStatus(problemCase, filters.status))
    .sort(compareProblemCases);

  return {
    filters: {
      ...filters,
      employeeOptions: buildEmployeeOptions(problemCases),
      typeOptions: buildTypeOptions(problemCases),
      riskOptions: buildRiskOptions(problemCases),
      statusOptions: STATUS_DEFINITIONS.map(([value, label]) => ({ value, label }))
    },
    selectedStatusLabel: (STATUS_DEFINITIONS.find(([value]) => value === filters.status) || STATUS_DEFINITIONS[0])[1],
    counts,
    kpis: [
      { key: 'active', label: 'Активные проблемы', value: counts.active },
      { key: 'isolated', label: 'В изоляции', value: counts.isolated },
      { key: 'highRisk', label: 'Высокий / критический риск', value: counts.highRisk },
      { key: 'resolved', label: 'Решенные проблемы', value: counts.resolved }
    ],
    problemCases: visibleCases,
    problemTypeSummary: buildProblemTypeSummary(filteredCases),
    riskSummary: buildRiskSummary(filteredCases),
    hasCases: problemCases.length > 0,
    hasResults: visibleCases.length > 0
  };
}

function attachProblemRelations(batches = []) {
  const items = Array.isArray(batches) ? batches.map((batch) => ({ ...batch })) : [];
  const byCardId = new Map(items.map((batch) => [normalizeText(batch.cardId), batch]));
  const byCode = new Map(items.map((batch) => [normalizeText(batch.code), batch]));

  items.forEach((batch) => {
    const parent = byCardId.get(normalizeText(batch.parentCardId)) || byCode.get(normalizeText(batch.parentCode)) || null;
    batch.parentBatch = parent
      ? {
          batchKey: parent.batchKey,
          code: parent.code,
          title: parent.title,
          reportId: parent.reportId
        }
      : null;
  });

  return items;
}

function buildProblemCase(batch = {}) {
  const problemTimeline = collectProblemTimeline(batch);
  const activeProblemQuantity = toPositiveNumber(batch.activeProblemQuantity);
  const isolationStatus = normalizeText(batch.isolationStatus);
  const originType = normalizeText(batch.originType);
  const hasHistory = Boolean(
    problemTimeline.length
    || activeProblemQuantity > 0
    || looksLikeProblemBatch(batch)
  );

  if (!hasHistory) {
    return null;
  }

  const isActive = resolveActiveState(batch, activeProblemQuantity);
  const isIsolated = originType === 'problemisolation' && isolationStatus === 'isolated';
  const isResolved = hasHistory && !isActive && !isIsolated;
  const firstProblemEvent = problemTimeline[problemTimeline.length - 1] || null;
  const latestProblemEvent = problemTimeline[0] || null;
  const riskKey = normalizeRisk(batch.riskLevel || latestProblemEvent && latestProblemEvent.risk || '');
  const typeLabel = firstNonEmpty(
    batch.problemType,
    latestProblemEvent && (latestProblemEvent.problemType || latestProblemEvent.problem || latestProblemEvent.title),
    'Не указан'
  );
  const statusKey = isActive ? 'active' : isIsolated ? 'isolated' : 'resolved';
  const reportId = String(batch.reportId || '').trim();
  const passportUrl = buildStagesUrl(batch.batchKey, reportId, 'passport');
  const journalUrl = buildStagesUrl(
    batch.batchKey,
    reportId,
    'journal',
    latestProblemEvent && latestProblemEvent.eventId ? latestProblemEvent.eventId : ''
  );

  return {
    id: String(batch.batchKey || '').trim(),
    batchKey: String(batch.batchKey || '').trim(),
    cardId: String(batch.cardId || '').trim(),
    reportId,
    title: firstNonEmpty(batch.title, batch.code, 'Партия без названия'),
    code: firstNonEmpty(batch.code, 'Без кода'),
    employeeKey: String(batch.employeeKey || '').trim() || 'all',
    employeeName: firstNonEmpty(batch.employeeName, 'Неизвестно'),
    stage: firstNonEmpty(batch.stage, 'Без стадии'),
    location: String(batch.location || '').trim(),
    currentQuantity: toPositiveNumber(batch.currentQuantity),
    activeProblemQuantity,
    unisolatedProblemQuantity: toPositiveNumber(batch.unisolatedProblemQuantity),
    healthyQuantity: toPositiveNumber(batch.healthyQuantity),
    healthStatus: normalizeText(batch.healthStatus),
    healthStatusLabel: firstNonEmpty(batch.healthStatusLabel, formatHealthStatus(batch.healthStatus), 'Не указан'),
    isolationStatus,
    isolationStatusLabel: firstNonEmpty(batch.isolationStatusLabel, formatIsolationStatus(batch.isolationStatus), 'Без изоляции'),
    originType,
    originLabel: firstNonEmpty(batch.originLabel, formatOriginType(batch.originType)),
    parentBatch: batch.parentBatch || null,
    problemType: typeLabel,
    riskKey,
    riskLabel: formatRiskLabel(riskKey),
    reportedAt: firstProblemEvent ? firstProblemEvent.createdAt : firstNonEmpty(batch.updatedAt, batch.createdAt),
    reportedAtLabel: formatDateTime(firstProblemEvent ? firstProblemEvent.createdAt : firstNonEmpty(batch.updatedAt, batch.createdAt)),
    reportedBy: firstProblemEvent ? firstNonEmpty(firstProblemEvent.createdBy, batch.employeeName, 'Неизвестно') : firstNonEmpty(batch.employeeName, 'Неизвестно'),
    latestActionTitle: latestProblemEvent ? latestProblemEvent.typeLabel : '',
    latestActionAt: latestProblemEvent ? latestProblemEvent.createdAt : '',
    latestActionAtLabel: latestProblemEvent ? formatDateTime(latestProblemEvent.createdAt) : '',
    statusKey,
    statusLabel: formatStatusLabel(statusKey),
    isActive,
    isIsolated,
    isResolved,
    passportUrl,
    journalUrl,
    searchText: [
      batch.title,
      batch.code,
      batch.employeeName,
      batch.stage,
      batch.problemType,
      batch.riskLevel,
      batch.location,
      batch.parentCode
    ].join(' ').toLowerCase()
  };
}

function collectProblemTimeline(batch = {}) {
  return (Array.isArray(batch.events) ? batch.events : [])
    .filter((event) => isProblemTimelineEvent(event))
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));
}

function isProblemTimelineEvent(event = {}) {
  const type = normalizeText(event.type).replace(/[^a-zа-яё]/g, '');
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease', 'problemisolation', 'isolatedfromparent', 'problemrecovery'].includes(type)) {
    return true;
  }

  return Boolean(
    firstNonEmpty(
      event.problemType,
      event.problem,
      event.riskLevel,
      event.risk,
      event.problemDescription,
      event.diseaseName,
      event.pestName
    )
  );
}

function looksLikeProblemBatch(batch = {}) {
  const status = normalizeText(batch.status);
  const healthStatus = normalizeText(batch.healthStatus);
  const isolationStatus = normalizeText(batch.isolationStatus);

  return Boolean(
    firstNonEmpty(batch.problemType, batch.riskLevel, batch.problemDescription)
    || status === 'problem'
    || (status === 'quarantine' && isolationStatus !== 'released')
    || healthStatus === 'infected'
    || healthStatus === 'problem'
    || healthStatus === 'unhealthy'
    || normalizeText(batch.sterilityStatus).includes('contamin')
  );
}

function resolveActiveState(batch = {}, activeProblemQuantity = 0) {
  if (activeProblemQuantity > 0) {
    return true;
  }

  const healthStatus = normalizeText(batch.healthStatus);
  const status = normalizeText(batch.status);
  const isolationStatus = normalizeText(batch.isolationStatus);

  if (healthStatus === 'resolved' || healthStatus === 'recovered' || isolationStatus === 'released') {
    return false;
  }

  return Boolean(
    !hasExplicitZero(batch.activeProblemQuantity)
    && (
      healthStatus === 'infected'
      || healthStatus === 'problem'
      || healthStatus === 'unhealthy'
      || status === 'problem'
      || (status === 'quarantine' && isolationStatus !== 'released')
    )
  );
}

function hasExplicitZero(value) {
  if (value === undefined || value === null || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

function resolveFilters(query = {}, problemCases = []) {
  const employeeOptions = buildEmployeeOptions(problemCases);
  const requestedEmployee = String(query.employee || 'all').trim() || 'all';
  const selectedEmployee = employeeOptions.some((option) => option.value === requestedEmployee)
    ? requestedEmployee
    : 'all';
  const requestedType = String(query.type || 'all').trim() || 'all';
  const typeOptions = buildTypeOptions(problemCases);
  const selectedType = typeOptions.some((option) => option.value === requestedType)
    ? requestedType
    : 'all';
  const requestedRisk = String(query.risk || 'all').trim() || 'all';
  const riskOptions = buildRiskOptions(problemCases);
  const selectedRisk = riskOptions.some((option) => option.value === requestedRisk)
    ? requestedRisk
    : 'all';
  const selectedStatus = STATUS_KEYS.get(normalizeText(query.status)) || 'active';

  return {
    employee: selectedEmployee,
    type: selectedType,
    risk: selectedRisk,
    status: selectedStatus
  };
}

function buildEmployeeOptions(problemCases = []) {
  const items = new Map();
  for (const problemCase of problemCases) {
    if (!problemCase.employeeKey || !problemCase.employeeName) continue;
    if (!items.has(problemCase.employeeKey)) {
      items.set(problemCase.employeeKey, {
        value: problemCase.employeeKey,
        label: problemCase.employeeName
      });
    }
  }

  return [
    { value: 'all', label: 'Все сотрудники' },
    ...[...items.values()].sort((left, right) => left.label.localeCompare(right.label, 'ru') || left.value.localeCompare(right.value, 'ru'))
  ];
}

function buildTypeOptions(problemCases = []) {
  const items = new Map();
  for (const problemCase of problemCases) {
    const value = String(problemCase.problemType || '').trim();
    if (!value || items.has(value)) continue;
    items.set(value, { value, label: value });
  }

  return [
    { value: 'all', label: 'Все типы проблем' },
    ...[...items.values()].sort((left, right) => left.label.localeCompare(right.label, 'ru'))
  ];
}

function buildRiskOptions(problemCases = []) {
  const items = new Map();
  for (const problemCase of problemCases) {
    const value = problemCase.riskKey || 'none';
    if (items.has(value)) continue;
    items.set(value, { value, label: formatRiskLabel(value) });
  }

  return [
    { value: 'all', label: 'Все риски' },
    ...[...items.values()].sort((left, right) => (RISK_INDEX.get(left.value) ?? Number.MAX_SAFE_INTEGER) - (RISK_INDEX.get(right.value) ?? Number.MAX_SAFE_INTEGER))
  ];
}

function matchesBaseFilters(problemCase = {}, filters = {}) {
  if (filters.employee !== 'all' && problemCase.employeeKey !== filters.employee) return false;
  if (filters.type !== 'all' && problemCase.problemType !== filters.type) return false;
  if (filters.risk !== 'all' && problemCase.riskKey !== filters.risk) return false;
  return true;
}

function matchesStatus(problemCase = {}, status = 'active') {
  if (status === 'all') {
    return problemCase.isActive || problemCase.isIsolated || problemCase.isResolved;
  }
  if (status === 'isolated') return problemCase.isIsolated;
  if (status === 'resolved') return problemCase.isResolved;
  return problemCase.isActive;
}

function countProblemCases(problemCases = []) {
  return {
    total: problemCases.filter((problemCase) => matchesStatus(problemCase, 'all')).length,
    active: problemCases.filter((problemCase) => problemCase.isActive).length,
    isolated: problemCases.filter((problemCase) => problemCase.isIsolated).length,
    resolved: problemCases.filter((problemCase) => problemCase.isResolved).length,
    highRisk: problemCases.filter((problemCase) => ['critical', 'high'].includes(problemCase.riskKey)).length
  };
}

function buildProblemTypeSummary(problemCases = []) {
  const counts = new Map();
  for (const problemCase of problemCases) {
    counts.set(problemCase.problemType, (counts.get(problemCase.problemType) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru'));
}

function buildRiskSummary(problemCases = []) {
  const counts = new Map();
  for (const problemCase of problemCases) {
    counts.set(problemCase.riskKey || 'none', (counts.get(problemCase.riskKey || 'none') || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: formatRiskLabel(key), count }))
    .sort((left, right) => (RISK_INDEX.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (RISK_INDEX.get(right.key) ?? Number.MAX_SAFE_INTEGER));
}

function compareProblemCases(left = {}, right = {}) {
  const riskRank = (RISK_INDEX.get(left.riskKey) ?? Number.MAX_SAFE_INTEGER) - (RISK_INDEX.get(right.riskKey) ?? Number.MAX_SAFE_INTEGER);
  if (riskRank !== 0) return riskRank;
  const leftTime = toTimestamp(left.reportedAt || left.latestActionAt);
  const rightTime = toTimestamp(right.reportedAt || right.latestActionAt);
  if (rightTime !== leftTime) return rightTime - leftTime;
  return String(left.title || '').localeCompare(String(right.title || ''), 'ru');
}

function buildStagesUrl(batchKey, reportId, tab, eventId = '') {
  const params = new URLSearchParams();
  if (batchKey) params.set('batch', batchKey);
  if (reportId) params.set('reportId', reportId);
  if (tab) params.set('tab', tab);
  if (eventId) params.set('eventId', eventId);
  const query = params.toString();
  return query ? `/stages?${query}` : '/stages';
}

function formatStatusLabel(value) {
  return ({
    active: 'Активная',
    isolated: 'В изоляции',
    resolved: 'Решена'
  })[normalizeText(value)] || String(value || '').trim();
}

function formatRiskLabel(value) {
  return ({
    critical: 'Критический',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
    none: 'Не указан'
  })[value] || 'Не указан';
}

function formatHealthStatus(value) {
  return ({
    infected: 'Проблема активна',
    problem: 'Проблема активна',
    unhealthy: 'Проблема активна',
    healthy: 'Здоровая',
    resolved: 'Проблема решена',
    recovered: 'Проблема решена'
  })[normalizeText(value)] || String(value || '').trim();
}

function formatIsolationStatus(value) {
  return ({
    isolated: 'Изолирована',
    quarantine: 'Изолирована',
    released: 'Изоляция снята',
    none: 'Без изоляции'
  })[normalizeText(value)] || String(value || '').trim();
}

function formatOriginType(value) {
  return ({
    cloned: 'Клон',
    problemisolation: 'Изолированная партия'
  })[normalizeText(value)] || String(value || '').trim();
}

function normalizeRisk(value) {
  const text = normalizeText(value);
  if (text.includes('critical') || text.includes('крит')) return 'critical';
  if (text.includes('high') || text.includes('высок')) return 'high';
  if (text.includes('medium') || text.includes('сред')) return 'medium';
  if (text.includes('low') || text.includes('низ')) return 'low';
  return 'none';
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow'
  }).format(new Date(timestamp));
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  buildProblemsPageModel,
  buildProblemCase
};
