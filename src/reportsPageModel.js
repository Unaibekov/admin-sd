function buildReportsPageModel(reports = [], query = {}) {
  const groups = new Map();
  const reportList = Array.isArray(reports) ? reports : [];

  for (const report of reportList) {
    const employeeLabel = resolveReportEmployee(report);
    const employeeKey = normalizeEmployeeKey(employeeLabel);
    const group = ensureEmployeeGroup(groups, employeeKey, employeeLabel);
    const summary = report && report.summary ? report.summary : {};
    const createdAtMs = toDateMs(report && report.createdAt);

    group.reportCount += 1;
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
      reports: employee.reports.sort((left, right) => right.createdAtMs - left.createdAtMs)
    }));

  const selectedEmployeeKey = normalizeEmployeeKey(query.employee);
  const selectedEmployee = employees.find((employee) => employee.key === selectedEmployeeKey) || null;

  return {
    employees,
    selectedEmployeeKey: selectedEmployee ? selectedEmployee.key : '',
    selectedEmployee,
    hasEmployees: employees.length > 0,
    hasSelectedEmployee: Boolean(selectedEmployee)
  };
}

function ensureEmployeeGroup(groups, employeeKey, employeeLabel) {
  if (!groups.has(employeeKey)) {
    groups.set(employeeKey, {
      key: employeeKey,
      label: employeeLabel,
      reportCount: 0,
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

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toDateMs(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

module.exports = {
  buildReportsPageModel
};
