const assert = require('assert/strict');
const { buildReportsPageModel, buildSelectedEmployeeDetail } = require('../src/reportsPageModel');

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

function buildReport({
  reportId,
  createdAt,
  displayCreatedAt,
  displayName,
  userId,
  role = 'operator',
  cards = [],
  summary = {}
}) {
  return {
    reportId,
    createdAt,
    displayCreatedAt,
    user: {
      userId: userId || `${reportId}-user`,
      displayName,
      role
    },
    summary,
    cards
  };
}

run('selects employee case-insensitively and keeps normalized search text', () => {
  const reports = [buildReport({
    reportId: 'report-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    displayCreatedAt: '30 \u0438\u044e\u043b\u044f',
    displayName: '  Anna Ivanova  ',
    summary: { cardsCount: 1, eventsCount: 2, photosCount: 3 }
  })];

  const page = buildReportsPageModel(reports, { employee: ' anna ivanova ' });

  assert.equal(page.hasEmployees, true);
  assert.equal(page.hasSelectedEmployee, true);
  assert.equal(page.selectedEmployeeKey, 'anna ivanova');
  assert.equal(page.selectedEmployee.key, 'anna ivanova');
  assert.equal(page.employees[0].searchText, 'anna ivanova');
  assert.equal(page.employees[0].reportCountLabel, '1 \u043e\u0442\u0447\u0435\u0442');
});

run('selects the latest employee by default', () => {
  const older = buildReport({
    reportId: 'older-report',
    createdAt: '2026-07-30T10:00:00.000Z',
    displayCreatedAt: '30 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova'
  });
  const newer = buildReport({
    reportId: 'newer-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Petr Petrov'
  });

  const page = buildReportsPageModel([older, newer], {});

  assert.equal(page.selectedEmployeeKey, 'petr petrov');
  assert.equal(page.selectedEmployee.label, 'Petr Petrov');
});

run('falls back to the first employee when employee query is invalid', () => {
  const older = buildReport({
    reportId: 'older-report',
    createdAt: '2026-07-30T10:00:00.000Z',
    displayCreatedAt: '30 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova'
  });
  const newer = buildReport({
    reportId: 'newer-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Petr Petrov'
  });

  const page = buildReportsPageModel([older, newer], { employee: 'missing employee' });

  assert.equal(page.selectedEmployeeKey, 'petr petrov');
  assert.equal(page.selectedEmployee.label, 'Petr Petrov');
});

run('keeps employees with the same display name separate when userIds differ', () => {
  const firstReport = buildReport({
    reportId: 'anna-report-a',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    userId: 'anna-user-a',
    cards: [{
      cardId: 'anna-a-card-1',
      code: 'ANNA-A-1',
      updatedAt: '2026-07-31T10:00:00.000Z',
      events: [{ eventId: 'anna-a-event-1', createdAt: '2026-07-31T10:00:00.000Z' }]
    }]
  });
  const secondReport = buildReport({
    reportId: 'anna-report-b',
    createdAt: '2026-07-31T11:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    userId: 'anna-user-b',
    cards: [{
      cardId: 'anna-b-card-1',
      code: 'ANNA-B-1',
      updatedAt: '2026-07-31T11:00:00.000Z',
      events: [{ eventId: 'anna-b-event-1', createdAt: '2026-07-31T11:00:00.000Z' }]
    }]
  });

  const page = buildReportsPageModel([firstReport, secondReport], { employee: 'anna-user-b' });

  assert.equal(page.employees.length, 2);
  assert.deepEqual(page.employees.map((employee) => employee.key).sort(), ['anna-user-a', 'anna-user-b']);
  assert.deepEqual(page.employees.map((employee) => employee.label).sort(), [
    'Anna Ivanova (anna-user-a)',
    'Anna Ivanova (anna-user-b)'
  ]);
  assert.equal(page.selectedEmployeeKey, 'anna-user-b');
  assert.equal(page.selectedEmployee.label, 'Anna Ivanova (anna-user-b)');
});

run('matches duplicate-name employees by plain employee query before disambiguated labels', () => {
  const firstReport = buildReport({
    reportId: 'anna-plain-name-a',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    userId: 'anna-user-a'
  });
  const secondReport = buildReport({
    reportId: 'anna-plain-name-b',
    createdAt: '2026-07-31T11:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    userId: 'anna-user-b'
  });

  const page = buildReportsPageModel([firstReport, secondReport], { employee: ' anna ivanova ' });

  assert.equal(page.selectedEmployeeKey, 'anna-user-b');
  assert.equal(page.selectedEmployee.label, 'Anna Ivanova (anna-user-b)');
});

run('uses readable fallback employee label when report metadata is missing', () => {
  const report = {
    reportId: 'unknown-employee-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    summary: { cardsCount: 1, eventsCount: 0, photosCount: 0 }
  };

  const page = buildReportsPageModel([report], { employee: '\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e' });

  assert.equal(page.employees.length, 1);
  assert.equal(page.employees[0].label, '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
  assert.equal(page.selectedEmployeeKey, '\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
});

run('derives employee aggregates from report cards when summary is missing', () => {
  const report = buildReport({
    reportId: 'summary-fallback-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    summary: {},
    cards: [{
      cardId: 'card-1',
      code: 'ANNA-1',
      photoFiles: ['photos/card-1.jpg'],
      events: [
        { eventId: 'event-1', createdAt: '2026-07-31T10:00:00.000Z', photoFiles: ['photos/event-1.jpg'] },
        { eventId: 'event-2', createdAt: '2026-07-31T11:00:00.000Z' }
      ]
    }, {
      cardId: 'card-2',
      code: 'ANNA-2',
      events: []
    }]
  });

  const page = buildReportsPageModel([report], { employee: 'anna ivanova' });

  assert.equal(page.employees.length, 1);
  assert.equal(page.employees[0].cardsCount, 2);
  assert.equal(page.employees[0].eventsCount, 2);
  assert.equal(page.employees[0].photosCount, 2);
  assert.equal(page.employees[0].cardsCountLabel, '2 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438');
  assert.equal(page.employees[0].eventsCountLabel, '2 \u0441\u043e\u0431\u044b\u0442\u0438\u044f');
  assert.equal(page.employees[0].photosCountLabel, '2 \u0444\u043e\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u0438');
});

run('keeps raw-only cards in selected employee detail', () => {
  const employee = {
    key: 'anna ivanova',
    label: 'Anna Ivanova',
    latestReportDate: '31 \u0438\u044e\u043b\u044f'
  };
  const report = buildReport({
    reportId: 'raw-only-detail-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    cards: []
  });
  report.raw = {
    cards: [{
      cardId: 'raw-card-1',
      code: 'RAW-1',
      updatedAt: '2026-07-31T10:00:00.000Z',
      events: [{ eventId: 'raw-event-1', createdAt: '2026-07-31T10:00:00.000Z' }]
    }]
  };

  const detail = buildSelectedEmployeeDetail(employee, [report]);

  assert.equal(detail.cardsCount, 1);
  assert.equal(detail.eventsCount, 1);
  assert.equal(detail.cards[0].code, 'RAW-1');
  assert.equal(detail.cards[0].sourceReportId, 'raw-only-detail-report');
});

run('keeps parsed event fields when raw snapshot event contains only eventId', () => {
  const employee = {
    key: 'anna ivanova',
    label: 'Anna Ivanova',
    latestReportDate: '31 \u0438\u044e\u043b\u044f'
  };
  const report = buildReport({
    reportId: 'raw-event-shadow-detail-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    displayCreatedAt: '31 \u0438\u044e\u043b\u044f',
    displayName: 'Anna Ivanova',
    cards: [{
      cardId: 'card-1',
      code: 'CARD-1',
      updatedAt: '2026-07-31T10:00:00.000Z',
      events: [{
        eventId: 'event-1',
        createdAt: '2026-07-31T10:00:00.000Z',
        type: 'sale',
        createdBy: 'Anna Ivanova',
        count: 4
      }]
    }]
  });
  report.raw = {
    cards: [{
      events: [{ eventId: 'event-1' }]
    }]
  };

  const detail = buildSelectedEmployeeDetail(employee, [report]);

  assert.equal(detail.cards[0].events[0].eventId, 'event-1');
  assert.equal(detail.cards[0].events[0].type, 'sale');
  assert.equal(detail.cards[0].events[0].createdBy, 'Anna Ivanova');
  assert.equal(detail.cards[0].events[0].count, 4);
});

if (process.exitCode) process.exit(process.exitCode);
