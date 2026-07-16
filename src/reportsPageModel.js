function buildReportsPageModel(reports = [], query = {}) {
  const groups = new Map();
  const reportList = Array.isArray(reports) ? reports : [];

  for (const report of reportList) {
    const employeeLabel = resolveReportEmployee(report);
    const employeeKey = normalizeEmployeeKey(employeeLabel);
    const group = ensureEmployeeGroup(groups, employeeKey, employeeLabel);
    const summary = report && report.summary ? report.summary : {};
    const createdAtMs = toDateMs(report && report.createdAt);

    group.cardsCount += toCount(summary.cardsCount);
    group.eventsCount += toCount(summary.eventsCount);
    group.photosCount += toCount(summary.photosCount);
    if (createdAtMs >= group.latestReportCreatedAtMs) {
      group.latestReportCreatedAtMs = createdAtMs;
      group.latestReportDate = report && report.displayCreatedAt ? report.displayCreatedAt : group.latestReportDate;
    }
    group.reports.push({
      reportId: report && report.reportId ? report.reportId : '',
      displayCreatedAt: report && report.displayCreatedAt ? report.displayCreatedAt : '',
      createdAtMs,
      cardsCount: toCount(summary.cardsCount),
      eventsCount: toCount(summary.eventsCount),
      photosCount: toCount(summary.photosCount),
      author: employeeLabel
    });
  }

  const employees = [...groups.values()]
    .sort((left, right) => {
      if (right.latestReportCreatedAtMs !== left.latestReportCreatedAtMs) {
        return right.latestReportCreatedAtMs - left.latestReportCreatedAtMs;
      }

      return left.label.localeCompare(right.label, 'ru');
    })
    .map((employee) => ({
      ...employee,
      searchText: buildEmployeeSearchText(employee.label),
      reports: employee.reports.sort((left, right) => right.createdAtMs - left.createdAtMs)
    }));

  const requestedEmployeeKey = normalizeEmployeeKey(query.employee);
  const selectedEmployee = employees.find((employee) => employee.key === requestedEmployeeKey) || employees[0] || null;

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

  const detailedReports = Array.isArray(reports)
    ? reports.filter(Boolean).sort((left, right) => toDateMs(right && right.createdAt) - toDateMs(left && left.createdAt))
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
    const cards = Array.isArray(report && report.cards) ? report.cards : [];

    cards.forEach((card, index) => {
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
  const aggregateKey = normalizeCardKey(
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

function resolveReportEmployee(report) {
  if (!report) {
    return 'Неизвестно';
  }

  const user = report.user || {};
  const userName = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return userName || report.author || report.userName || 'Неизвестно';
}

function normalizeEmployeeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildEmployeeSearchText(label) {
  return String(label || '')
    .trim()
    .toLowerCase();
}

function normalizeCardKey(value) {
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

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toDateMs(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

module.exports = {
  buildReportsPageModel,
  buildSelectedEmployeeDetail
};
