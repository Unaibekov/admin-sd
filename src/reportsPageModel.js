const { formatCountLabel } = require('./formatCountLabel');

const UNKNOWN_EMPLOYEE = 'Неизвестно';
const REPORT_LABELS = ['отчет', 'отчета', 'отчетов'];
const CARD_LABELS = ['карточка', 'карточки', 'карточек'];
const EVENT_LABELS = ['событие', 'события', 'событий'];
const PHOTO_LABELS = ['фотография', 'фотографии', 'фотографий'];

function buildReportsPageModel(reports = [], query = {}) {
  const groups = new Map();
  const reportList = Array.isArray(reports) ? reports : [];
  const resolveEmployeeKey = buildReportEmployeeKeyResolver(reportList);

  for (const report of reportList) {
    const employeeLabel = resolveReportEmployeeName(report);
    const employeeKey = resolveEmployeeKey(report);
    const group = ensureEmployeeGroup(groups, employeeKey, employeeLabel);
    const counts = resolveReportCounts(report);
    const createdAtMs = toDateMs(report && report.createdAt);

    group.cardsCount += counts.cardsCount;
    group.eventsCount += counts.eventsCount;
    group.photosCount += counts.photosCount;
    if (createdAtMs >= group.latestReportCreatedAtMs) {
      group.latestReportCreatedAtMs = createdAtMs;
      group.latestReportDate = report && report.displayCreatedAt ? report.displayCreatedAt : '';
    }
    group.reports.push({
      reportId: report && report.reportId ? report.reportId : '',
      displayCreatedAt: report && report.displayCreatedAt ? report.displayCreatedAt : '',
      createdAtMs,
      cardsCount: counts.cardsCount,
      eventsCount: counts.eventsCount,
      photosCount: counts.photosCount,
      author: employeeLabel
    });
  }

  const employees = disambiguateEmployeeLabels([...groups.values()]
    .sort((left, right) => {
      if (right.latestReportCreatedAtMs !== left.latestReportCreatedAtMs) {
        return right.latestReportCreatedAtMs - left.latestReportCreatedAtMs;
      }

      return left.label.localeCompare(right.label, 'ru');
    })
    .map((employee) => ({
      ...employee,
      baseLabel: employee.label,
      baseSearchText: normalizeLookupText(employee.label),
      searchText: normalizeLookupText(employee.label),
      reportCountLabel: formatCountLabel(employee.reports.length, REPORT_LABELS),
      cardsCountLabel: formatCountLabel(employee.cardsCount, CARD_LABELS),
      eventsCountLabel: formatCountLabel(employee.eventsCount, EVENT_LABELS),
      photosCountLabel: formatCountLabel(employee.photosCount, PHOTO_LABELS),
      reports: employee.reports.sort((left, right) => right.createdAtMs - left.createdAtMs)
    })));

  const requestedEmployeeKey = normalizeLookupText(query.employee);
  const selectedEmployee = requestedEmployeeKey
    ? employees.find((employee) => employee.key === requestedEmployeeKey)
      || employees.find((employee) => employee.searchText === requestedEmployeeKey)
      || employees.find((employee) => employee.baseSearchText === requestedEmployeeKey)
      || employees[0]
      || null
    : employees[0] || null;

  return {
    employees,
    selectedEmployeeKey: selectedEmployee ? selectedEmployee.key : '',
    selectedEmployee,
    hasEmployees: employees.length > 0,
    hasSelectedEmployee: Boolean(selectedEmployee)
  };
}

function buildSelectedEmployeeDetail(employee, reports = []) {
  if (!employee) {
    return null;
  }

  const employeeKey = normalizeLookupText(employee.key || employee.label);
  const resolveEmployeeKey = buildReportEmployeeKeyResolver(reports);
  const detailedReports = Array.isArray(reports)
    ? reports
      .filter(Boolean)
      .filter((report) => {
        const reportKey = resolveEmployeeKey(report);
        const reportSearchText = normalizeLookupText(resolveReportEmployeeName(report));
        return reportKey === employeeKey || reportSearchText === employeeKey;
      })
      .sort((left, right) => toDateMs(right && right.createdAt) - toDateMs(left && left.createdAt))
    : [];
  const cards = buildUniqueEmployeeCards(detailedReports);

  return {
    key: employee.key,
    label: employee.label,
    reportCount: detailedReports.length,
    latestReportDate: employee.latestReportDate,
    cardsCount: cards.length,
    eventsCount: cards.reduce((total, card) => total + (Array.isArray(card.events) ? card.events.length : 0), 0),
    cards,
    reports: detailedReports.map((report) => ({
      reportId: report.reportId,
      displayCreatedAt: report.displayCreatedAt || '',
      createdAt: report.createdAt || ''
    }))
  };
}

function buildUniqueEmployeeCards(reports = []) {
  const cardMap = new Map();

  reports.forEach((report) => {
    const parsedCards = Array.isArray(report && report.cards) ? report.cards : [];
    const rawCards = Array.isArray(report && report.raw && report.raw.cards) ? report.raw.cards : [];

    Array.from({ length: Math.max(parsedCards.length, rawCards.length) }, (_, index) => {
      const card = mergeCardSnapshot(parsedCards[index], rawCards[index]);
      const normalizedCard = decorateEmployeeCard(card, report, index);
      const key = normalizedCard.aggregateKey;
      const existing = cardMap.get(key);

      if (!existing || normalizedCard.sortTimestamp > existing.sortTimestamp) {
        cardMap.set(key, normalizedCard);
      }
    });
  });

  return [...cardMap.values()].sort((left, right) => {
    if (right.sortTimestamp !== left.sortTimestamp) {
      return right.sortTimestamp - left.sortTimestamp;
    }

    return String(left.code || left.cardId || '').localeCompare(String(right.code || right.cardId || ''), 'ru');
  });
}

function decorateEmployeeCard(card, report, index) {
  const events = Array.isArray(card && card.events) ? card.events : [];
  const latestEventTimestamp = events.reduce((latest, event) => {
    const current = toDateMs(event && (event.createdAt || event.date || event.time));
    return current > latest ? current : latest;
  }, 0);
  const sortTimestamp = Math.max(
    latestEventTimestamp,
    toDateMs(card && card.updatedAt),
    toDateMs(card && card.createdAt),
    toDateMs(report && report.createdAt)
  );
  const aggregateKey = normalizeLookupText(
    firstValue([
      card && card.cardId,
      card && card.code,
      card && card.partyCode,
      `${report && report.reportId ? report.reportId : 'report'}-${index + 1}`
    ])
  );

  return {
    ...(card && typeof card === 'object' ? card : {}),
    sourceReportId: report && report.reportId ? report.reportId : '',
    sourceReportDate: report && report.displayCreatedAt ? report.displayCreatedAt : '',
    aggregateKey,
    sortTimestamp
  };
}

function ensureEmployeeGroup(groups, employeeKey, employeeLabel) {
  if (!groups.has(employeeKey)) {
    groups.set(employeeKey, {
      key: employeeKey,
      label: employeeLabel,
      cardsCount: 0,
      eventsCount: 0,
      photosCount: 0,
      latestReportCreatedAtMs: 0,
      latestReportDate: '',
      reports: []
    });
  }

  return groups.get(employeeKey);
}

function disambiguateEmployeeLabels(employees = []) {
  const duplicateCounts = new Map();

  for (const employee of employees) {
    const labelKey = normalizeLookupText(employee && employee.label);
    if (!labelKey) continue;
    duplicateCounts.set(labelKey, (duplicateCounts.get(labelKey) || 0) + 1);
  }

  return employees.map((employee) => {
    const label = String(employee && employee.label || '').trim();
    const key = String(employee && employee.key || '').trim();
    const labelKey = normalizeLookupText(label);

    if (!label || !key || (duplicateCounts.get(labelKey) || 0) < 2) {
      return employee;
    }

    return {
      ...employee,
      label: `${label} (${key})`
    };
  });
}

function resolveReportEmployeeName(report) {
  if (!report) {
    return UNKNOWN_EMPLOYEE;
  }

  const user = report.user || {};
  const displayName = String(user.displayName || '').trim();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const author = String(report.author || '').trim();
  const userName = String(report.userName || '').trim();
  return displayName || fullName || author || userName || UNKNOWN_EMPLOYEE;
}

function resolveReportEmployeeIdentity(report) {
  if (!report) {
    return normalizeLookupText(UNKNOWN_EMPLOYEE);
  }

  const user = report.user || {};
  return normalizeLookupText(firstValue([
    user.userId,
    resolveReportEmployeeName(report),
    report.author,
    report.userName
  ]));
}

function buildReportEmployeeKeyResolver(reports = []) {
  const identitiesByName = new Map();
  const reportList = Array.isArray(reports) ? reports : [];

  for (const report of reportList) {
    const nameKey = normalizeLookupText(resolveReportEmployeeName(report));
    const identityKey = resolveReportEmployeeIdentity(report);
    if (!nameKey) continue;
    const identities = identitiesByName.get(nameKey) || new Set();
    if (identityKey) identities.add(identityKey);
    identitiesByName.set(nameKey, identities);
  }

  return function resolveReportEmployeeKeyFromList(report) {
    const nameKey = normalizeLookupText(resolveReportEmployeeName(report));
    const identityKey = resolveReportEmployeeIdentity(report);
    const identities = identitiesByName.get(nameKey);

    if (identities && identities.size > 1 && identityKey) {
      return identityKey;
    }

    return nameKey || identityKey || normalizeLookupText('unknown');
  };
}

function resolveReportEmployeeKey(report, reports = []) {
  return buildReportEmployeeKeyResolver(reports)(report);
}

function resolveReportCounts(report) {
  const summary = report && report.summary ? report.summary : {};
  const parsedCards = Array.isArray(report && report.cards) ? report.cards : [];
  const rawCards = Array.isArray(report && report.raw && report.raw.cards) ? report.raw.cards : [];
  const cards = Array.from(
    { length: Math.max(parsedCards.length, rawCards.length) },
    (_, index) => mergeCardSnapshot(parsedCards[index], rawCards[index])
  );
  const derivedCardsCount = cards.length;
  const derivedEventsCount = cards.reduce(
    (total, card) => total + (Array.isArray(card && card.events) ? card.events.length : 0),
    0
  );
  const derivedPhotosCount = cards.reduce((total, card) => {
    const events = Array.isArray(card && card.events) ? card.events : [];
    const cardPhotos = collectPhotoValues(card).length;
    const eventPhotos = events.reduce((eventTotal, event) => eventTotal + collectPhotoValues(event).length, 0);
    return total + cardPhotos + eventPhotos;
  }, 0);

  return {
    cardsCount: readCount(summary.cardsCount, derivedCardsCount),
    eventsCount: readCount(summary.eventsCount, derivedEventsCount),
    photosCount: readCount(summary.photosCount, derivedPhotosCount)
  };
}

function readCount(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function collectPhotoValues(source) {
  const values = new Set();
  [
    source && source.photos,
    source && source.photoFiles,
    source && source.photoPath,
    source && source.photoPaths,
    source && source.photoUri,
    source && source.photoUris
  ].forEach((value) => collectPhotoAliases(value, values));
  return [...values];
}

function collectPhotoAliases(value, target) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPhotoAliases(item, target));
    return;
  }

  if (typeof value === 'string' && value.trim()) {
    target.add(value.trim());
    return;
  }

  if (value && typeof value === 'object') {
    collectPhotoAliases(value.photoPath, target);
    collectPhotoAliases(value.photoUri, target);
    collectPhotoAliases(value.path, target);
    collectPhotoAliases(value.uri, target);
  }
}

function mergeCardSnapshot(parsedCard, rawCard) {
  const mergedCard = mergeSnapshotEntity(parsedCard, rawCard);
  const parsedEvents = Array.isArray(parsedCard && parsedCard.events) ? parsedCard.events : [];
  const rawEvents = Array.isArray(rawCard && rawCard.events) ? rawCard.events : [];
  mergedCard.events = Array.from(
    { length: Math.max(parsedEvents.length, rawEvents.length) },
    (_, eventIndex) => mergeSnapshotEntity(parsedEvents[eventIndex], rawEvents[eventIndex])
  );
  return mergedCard;
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

function normalizeLookupText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
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

function toDateMs(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

module.exports = {
  buildReportsPageModel,
  buildSelectedEmployeeDetail,
  resolveReportEmployeeKey
};
