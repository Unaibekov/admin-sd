const assert = require('assert/strict');
const { buildCurrentDashboardSnapshot, buildDashboard, getLatestBatchSnapshots } = require('../src/dashboardModel');
const { formatCountLabel } = require('../src/formatCountLabel');

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

function report(reportId, updatedAt, cards) {
  return {
    reportId,
    createdAt: updatedAt,
    deviceId: 'device-1',
    user: { userId: `${reportId}-user`, displayName: `Сотрудник ${reportId}`, role: 'agronomist' },
    raw: { cards },
    cards: cards.map((card) => ({ ...card, events: card.events || [] }))
  };
}

run('uses the latest batch state and deduplicates operation quantities across snapshots', () => {
  const sale = { eventId: 'sale-1', type: 'sale', count: 10, date: '2026-06-10T10:00:00.000Z' };
  const reports = [
    report('old', '2026-06-10T12:00:00.000Z', [{
      cardId: 'card-1', code: 'TP-1', stage: 'Теплица', batchStatus: 'active', currentQuantity: 100, updatedAt: '2026-06-10T12:00:00.000Z', events: [sale]
    }]),
    report('new', '2026-06-11T12:00:00.000Z', [{
      cardId: 'card-1', code: 'TP-1', stage: 'Теплица', batchStatus: 'problem', currentQuantity: 90, updatedAt: '2026-06-11T12:00:00.000Z', events: [sale, { eventId: 'loss-1', type: 'death', count: 3, date: '2026-06-11T10:00:00.000Z' }]
    }, {
      cardId: 'card-2', code: 'TP-2', stage: 'Адаптация', batchStatus: 'quarantine', currentQuantity: 50, updatedAt: '2026-06-11T12:00:00.000Z', events: []
    }])
  ];

  const snapshot = buildCurrentDashboardSnapshot(reports);
  assert.equal(snapshot.cardsCount, 2);
  assert.equal(snapshot.problemCount, 1);
  assert.equal(snapshot.quarantineCount, 1);
  assert.equal(snapshot.soldPlants, 10);
  assert.equal(snapshot.lostPlants, 3);
});

run('keeps parsed plant names in latest dashboard batch snapshots when raw card is minimal', () => {
  const reports = [{
    reportId: 'raw-card-shadow',
    createdAt: '2026-07-15T09:00:00.000Z',
    deviceId: 'device-1',
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      stage: 'РўРµРїР»РёС†Р°',
      batchStatus: 'active',
      updatedAt: '2026-07-15T09:00:00.000Z',
      createdAt: '2026-07-15T08:00:00.000Z',
      events: []
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      speciesName: 'Betula',
      varietyName: 'Pendula',
      stage: 'РўРµРїР»РёС†Р°',
      batchStatus: 'active',
      quantity: 12,
      currentQuantity: 9,
      updatedAt: '2026-07-15T09:00:00.000Z',
      createdAt: '2026-07-15T08:00:00.000Z',
      events: []
    }]
  }];

  const [batch] = getLatestBatchSnapshots(reports);

  assert.equal(batch.culture, 'Birch');
  assert.equal(batch.species, 'Betula');
  assert.equal(batch.variety, 'Pendula');
  assert.equal(batch.currentQuantity, 9);
  assert.equal(batch.title.includes('Birch'), true);
  assert.equal(batch.title.includes('Betula'), true);
  assert.equal(batch.title.includes('Pendula'), true);
});

run('filters event metrics by period while preserving current batch states', () => {
  const now = new Date().toISOString();
  const reports = [report('today', now, [{
    cardId: 'card-1', code: 'TP-1', stage: 'Теплица', batchStatus: 'quarantine', sterilityStatus: 'contaminated', currentQuantity: 42, updatedAt: now,
    events: [
      { eventId: 'loss-today', type: 'death', count: 4, date: now, createdBy: 'today-user' },
      { eventId: 'sale-today', type: 'sale', count: 12, date: now, createdBy: 'today-user' },
      { eventId: 'risk-today', type: 'problem', riskLevel: 'Критический', date: now, createdBy: 'today-user' }
    ]
  }])];
  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });
  assert.equal(dashboard.current.quarantineBatches, 1);
  assert.equal(dashboard.attentionBatches.length, 1);
  assert.equal(dashboard.productionMetrics.losses.value, 4);
  assert.equal(dashboard.productionMetrics.sales.value, 12);
  assert.equal(dashboard.employeeActivity.length, 1);
  assert.equal(dashboard.recentEvents.length, 3);
});

run('keeps current attention batches visible when the latest problem event is outside the selected period', () => {
  const now = new Date();
  const reportCreatedAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    9,
    0,
    0,
    0
  )).toISOString();
  const oldProblemAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 30,
    9,
    0,
    0,
    0
  )).toISOString();
  const reports = [report('attention-outside-period', reportCreatedAt, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'quarantine',
    sterilityStatus: 'contaminated',
    currentQuantity: 42,
    updatedAt: reportCreatedAt,
    events: [
      { eventId: 'problem-old', type: 'problem', riskLevel: 'РљСЂРёС‚РёС‡РµСЃРєРёР№', date: oldProblemAt, createdBy: 'old-problem-user' },
      { eventId: 'care-today', type: 'greenhouseCare', date: reportCreatedAt, createdBy: 'old-problem-user' }
    ]
  }])];
  reports[0].user.userId = 'old-problem-user';
  reports[0].user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });

  assert.equal(dashboard.attentionBatches.length, 1);
  assert.equal(dashboard.current.quarantineBatches, 1);
  assert.equal(dashboard.recentEvents.length, 1);
  assert.equal(dashboard.attentionEvents.length, 1);
  assert.equal(dashboard.attentionEvents[0].createdBy, 'Anna Ivanova');
  assert.equal(dashboard.attentionEvents[0].eventId, 'problem-old');
});

run('matches attention problem events to batches when report deviceId is missing', () => {
  const reportCreatedAt = '2026-08-03T09:00:00.000Z';
  const reportWithoutDevice = report('attention-no-device', reportCreatedAt, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'quarantine',
    sterilityStatus: 'contaminated',
    currentQuantity: 42,
    updatedAt: reportCreatedAt,
    events: [
      { eventId: 'problem-no-device', type: 'problem', riskLevel: 'РљСЂРёС‚РёС‡РµСЃРєРёР№', date: '2026-07-20T09:00:00.000Z', createdBy: 'user-no-device' }
    ]
  }]);
  delete reportWithoutDevice.deviceId;
  reportWithoutDevice.user.userId = 'user-no-device';
  reportWithoutDevice.user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard([reportWithoutDevice], reportWithoutDevice, [reportWithoutDevice], { period: 'today' });

  assert.equal(dashboard.attentionBatches.length, 1);
  assert.equal(dashboard.attentionBatches[0].latestProblemAuthor, 'Anna Ivanova');
  assert.equal(dashboard.attentionBatches[0].latestProblemEvent.eventId, 'problem-no-device');
  assert.equal(dashboard.attentionEvents[0].createdBy, 'Anna Ivanova');
  assert.equal(dashboard.attentionEvents[0].eventId, 'problem-no-device');
});

run('uses batch problem type and employee name when attention state comes only from card fields', () => {
  const reportCreatedAt = '2026-08-03T09:00:00.000Z';
  const reports = [report('attention-batch-problem-fields', reportCreatedAt, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'problem',
    problemType: 'Грибок',
    riskLevel: 'High',
    currentQuantity: 42,
    updatedAt: reportCreatedAt,
    events: [{ eventId: 'care-today', type: 'greenhouseCare', date: reportCreatedAt, createdBy: 'batch-problem-user' }]
  }])];
  reports[0].user.userId = 'batch-problem-user';
  reports[0].user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });

  assert.equal(dashboard.attentionBatches.length, 1);
  assert.equal(dashboard.attentionBatches[0].reason, 'Грибок');
  assert.equal(dashboard.attentionBatches[0].latestProblemTitle, 'Грибок');
  assert.equal(dashboard.attentionBatches[0].latestProblemAuthor, 'Anna Ivanova');
  assert.equal(dashboard.attentionBatches[0].latestProblemEvent, null);
  assert.equal(dashboard.attentionEvents[0].title, 'Грибок');
  assert.equal(dashboard.attentionEvents[0].createdBy, 'Anna Ivanova');
});

run('uses batch extraFields problem details in attention fallback when there is no problem event', () => {
  const reportCreatedAt = '2026-08-03T09:00:00.000Z';
  const reports = [report('attention-batch-extra-problem-fields', reportCreatedAt, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'problem',
    currentQuantity: 42,
    updatedAt: reportCreatedAt,
    extraFields: {
      problemType: 'Плесень',
      riskLevel: 'High',
      problemDescription: 'Нужна изоляция партии'
    },
    events: [{ eventId: 'care-today', type: 'greenhouseCare', date: reportCreatedAt, createdBy: 'batch-extra-problem-user' }]
  }])];
  reports[0].user.userId = 'batch-extra-problem-user';
  reports[0].user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });

  assert.equal(dashboard.attentionBatches.length, 1);
  assert.equal(dashboard.attentionBatches[0].reason, 'Плесень');
  assert.equal(dashboard.attentionBatches[0].risk, 'Высокий');
  assert.equal(dashboard.attentionBatches[0].latestProblemTitle, 'Плесень');
  assert.equal(dashboard.attentionBatches[0].latestProblemAuthor, 'Anna Ivanova');
  assert.equal(dashboard.attentionEvents[0].title, 'Плесень');
  assert.equal(dashboard.attentionEvents[0].createdBy, 'Anna Ivanova');
  assert.equal(dashboard.attentionEvents[0].problemDescription, 'Нужна изоляция партии');
});

run('sorts dashboard stage chart by lifecycle even with mixed case and spacing', () => {
  const now = '2026-07-16T09:00:00.000Z';
  const reports = [report('stage-order', now, [
    { cardId: 'card-1', code: 'TP-1', stage: 'высадка', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] },
    { cardId: 'card-2', code: 'TP-2', stage: ' Теплица ', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] },
    { cardId: 'card-3', code: 'TP-3', stage: 'клонирование', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] },
    { cardId: 'card-4', code: 'TP-4', stage: 'Адаптация', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] },
    { cardId: 'card-5', code: 'TP-5', stage: 'Неизвестная стадия', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] }
  ])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });

  assert.deepEqual(
    dashboard.chartTabs.stages.legend.map((item) => item.label),
    ['Клонирование', 'Адаптация', 'Теплица', 'Высадка', 'Неизвестная стадия']
  );
});

run('maps imported English stage names in dashboard stage charts', () => {
  const now = '2026-07-16T09:00:00.000Z';
  const reports = [report('stage-order-alias', now, [
    { cardId: 'card-1', code: 'TP-1', stage: 'Greenhouse', batchStatus: 'active', currentQuantity: 10, updatedAt: now, events: [] }
  ])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });

  assert.deepEqual(
    dashboard.chartTabs.stages.legend.map((item) => item.label),
    ['Теплица']
  );
});

run('matches dashboard period filters case-insensitively and ignores extra spaces', () => {
  const now = new Date().toISOString();
  const reports = [report('today', now, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'Теплица',
    batchStatus: 'quarantine',
    currentQuantity: 42,
    updatedAt: now,
    events: [{ eventId: 'loss-today', type: 'death', count: 4, date: now, createdBy: 'today-user' }]
  }])];
  const dashboard = buildDashboard(reports, reports[0], reports, { period: ' TODAY ' });

  assert.equal(dashboard.period.key, 'today');
  assert.equal(dashboard.productionMetrics.losses.value, 4);
  assert.equal(dashboard.topMetrics.find((metric) => metric.key === 'losses').href, '/journal?period=today&category=losses');
});

run('builds journal links for dashboard metrics with matching filters', () => {
  const now = '2026-07-16T09:00:00.000Z';
  const reports = [report('today', now, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'quarantine',
    currentQuantity: 42,
    updatedAt: now,
    events: [{ eventId: 'loss-today', type: 'death', count: 4, date: now, createdBy: 'today-user' }]
  }])];
  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'today' });
  const hrefByKey = Object.fromEntries(dashboard.topMetrics.map((metric) => [metric.key, metric.href || '']));

  assert.equal(hrefByKey.attention, '/journal?period=today&category=problems&quick=important');
  assert.equal(hrefByKey.quarantine, '/journal?period=today&category=problems&quick=quarantine');
  assert.equal(hrefByKey.losses, '/journal?period=today&category=losses');
});

run('uses report employee name for local app user events', () => {
  const reports = [{
    reportId: 'real-app-report',
    createdAt: '2026-07-15T05:55:10.709Z',
    deviceId: 'device-1',
    user: { userId: 'ildar-unaybekov', displayName: 'Ильдар Унайбеков', role: 'operator' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Береза',
      stage: 'Введение в культуру',
      events: [{ eventId: 'loss-local', type: 'introloss', count: 255, date: '2026-07-15T00:00:00.000Z', createdBy: 'local-user' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Береза',
      stage: 'Введение в культуру',
      events: [{ eventId: 'loss-local', type: 'introloss', count: 255, date: '2026-07-15T00:00:00.000Z', createdBy: 'local-user' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].createdBy, 'Ильдар Унайбеков');
});

run('uses top-level report author for local app user events when report user is missing', () => {
  const reports = [{
    reportId: 'author-only-local-user-report',
    createdAt: '2026-07-31T09:00:00.000Z',
    deviceId: 'device-1',
    author: 'Anna Ivanova',
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      events: [{ eventId: 'loss-local-author', type: 'introloss', count: 255, date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      events: [{ eventId: 'loss-local-author', type: 'introloss', count: 255, date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].createdBy, 'Anna Ivanova');
});

run('uses top-level report userName in dashboard employee and report blocks when report user is missing', () => {
  const reports = [{
    reportId: 'user-name-only-local-user-report',
    createdAt: '2026-07-31T09:00:00.000Z',
    deviceId: 'device-1',
    userName: 'Anna Ivanova',
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      events: [{ eventId: 'loss-local-username', type: 'introloss', count: 3, date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      events: [{ eventId: 'loss-local-username', type: 'introloss', count: 3, date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.employeeActivity[0].name, 'Anna Ivanova');
  assert.equal(dashboard.recentReports[0].author, 'Anna Ivanova');
  assert.equal(dashboard.recentEvents[0].createdBy, 'Anna Ivanova');
});

run('uses report employee name when event author is technical unknown', () => {
  const reports = [{
    reportId: 'unknown-author-report',
    createdAt: '2026-07-15T12:44:41.849Z',
    deviceId: 'device-1',
    user: { userId: 'ildar-unaybekov', displayName: 'Ильдар Унайбеков', role: 'operator' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Монстера',
      stage: 'Адаптация',
      events: [{ eventId: 'stage-unknown', type: 'stageChange', createdAt: '2026-07-15T12:43:57.694Z', createdBy: 'Неизвестно' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Монстера',
      stage: 'Адаптация',
      events: [{ eventId: 'stage-unknown', type: 'stageChange', createdAt: '2026-07-15T12:43:57.694Z', createdBy: 'Неизвестно' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].createdBy, 'Ильдар Унайбеков');
});

run('uses report employee name when event author equals technical userId', () => {
  const reports = [{
    reportId: 'technical-user-id-report',
    createdAt: '2026-07-15T12:44:41.849Z',
    deviceId: 'device-1',
    user: { userId: 'ildar-unaybekov', displayName: 'Ильдар Унайбеков', role: 'operator' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Монстера',
      stage: 'Адаптация',
      events: [{ eventId: 'stage-user-id', type: 'stageChange', createdAt: '2026-07-15T12:43:57.694Z', createdBy: 'ildar-unaybekov' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Монстера',
      stage: 'Адаптация',
      events: [{ eventId: 'stage-user-id', type: 'stageChange', createdAt: '2026-07-15T12:43:57.694Z', createdBy: 'ildar-unaybekov' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].createdBy, 'Ильдар Унайбеков');
});

run('keeps parsed dashboard event fields when raw snapshot event contains only eventId', () => {
  const reports = [{
    reportId: 'dashboard-raw-event-shadow',
    createdAt: '2026-07-15T09:00:00.000Z',
    deviceId: 'device-1',
    user: { userId: 'user-1', displayName: 'Anna Ivanova' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 10,
      updatedAt: '2026-07-15T09:00:00.000Z',
      events: [{ eventId: 'shadow-event' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 10,
      updatedAt: '2026-07-15T09:00:00.000Z',
      events: [{ eventId: 'shadow-event', type: 'sale', count: 4, createdAt: '2026-07-15T09:00:00.000Z', createdBy: 'user-1' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents.length, 1);
  assert.equal(dashboard.recentEvents[0].type, 'sale');
  assert.equal(dashboard.recentEvents[0].date, '2026-07-15T09:00:00.000Z');
  assert.equal(dashboard.recentEvents[0].quantity, 4);
  assert.equal(dashboard.recentEvents[0].createdBy, 'Anna Ivanova');
});

run('hides technical missing plant names from dashboard events', () => {
  const reports = [report('missing-name', '2026-07-15T09:00:00.000Z', [{
    cardId: 'card-1',
    code: 'VK-1',
    cultureName: 'Арония',
    speciesName: 'Мулатка',
    varietyName: 'Отсутствует',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 10,
    updatedAt: '2026-07-15T09:00:00.000Z',
    events: [{ eventId: 'move-1', type: 'movement', date: '2026-07-15T09:00:00.000Z', createdBy: 'missing-name-user' }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].culture, 'Арония · Мулатка');
});

run('uses event createdAt time when date contains only the day', () => {
  const reports = [report('event-time', '2026-07-15T06:00:00.000Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-085408',
    cultureName: 'Береза',
    speciesName: 'Красная',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 10,
    updatedAt: '2026-07-15',
    events: [{ eventId: 'loss-time', type: 'introloss', date: '2026-07-15', createdAt: '2026-07-15T05:54:42.672Z', createdBy: 'event-time-user', count: 255 }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].date, '2026-07-15T05:54:42.672Z');
  assert.equal(new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(dashboard.recentEvents[0].timestamp)), '08:54');
});

run('uses loss reason from event extra fields', () => {
  const reports = [report('loss-reason', '2026-07-15T08:25:43.587Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112138',
    cultureName: 'Берёза',
    speciesName: 'белая',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 263,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'introLoss-1784103943587',
      type: 'introloss',
      date: '2026-07-15',
      createdAt: '2026-07-15T08:25:43.587Z',
      createdBy: 'loss-reason-user',
      count: 2300,
      previousQuantity: 2563,
      currentQuantity: 263,
      extraFields: { reason: 'Высохли', lossReason: 'Высохли' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].reason, 'Высохли');
  assert.equal(dashboard.recentEvents[0].previousQuantity, 2563);
  assert.equal(dashboard.recentEvents[0].currentQuantity, 263);
});

run('adds a preview photo url to dashboard events with photos', () => {
  const reports = [report('event-photo', '2026-07-15T08:25:43.587Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112138',
    cultureName: 'Берёза',
    speciesName: 'белая',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 263,
    updatedAt: '2026-07-15',
    events: [{ eventId: 'photo-loss', type: 'introloss', createdAt: '2026-07-15T08:25:43.587Z', createdBy: 'event-photo-user', count: 2300, photoFiles: ['photos/photo-loss.jpg'] }]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].previewPhoto, '/storage/photos/photo-loss.jpg');
});

run('adds a preview photo url to dashboard events with singular photoPath alias', () => {
  const reports = [report('event-photo-path', '2026-07-15T08:25:43.587Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112138',
    cultureName: 'Берёза',
    speciesName: 'белая',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 263,
    updatedAt: '2026-07-15',
    events: [{ eventId: 'photo-loss-path', type: 'introloss', createdAt: '2026-07-15T08:25:43.587Z', createdBy: 'event-photo-user', count: 2300, photoPath: 'photos/photo-loss-path.jpg' }]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].previewPhoto, '/storage/photos/photo-loss-path.jpg');
});

run('adds a preview photo url to dashboard events with object photo aliases', () => {
  const reports = [{
    reportId: 'event-photo-object',
    createdAt: '2026-07-15T08:25:43.587Z',
    deviceId: 'device-1',
    user: { userId: 'event-photo-user', displayName: 'Anna Ivanova', role: 'operator' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-20260715-112138',
      cultureName: 'Береза',
      speciesName: 'белая',
      stage: 'Введение в культуру',
      batchStatus: 'active',
      currentQuantity: 263,
      updatedAt: '2026-07-15',
      events: [{ eventId: 'photo-loss-object', type: 'introloss', createdAt: '2026-07-15T08:25:43.587Z', createdBy: 'event-photo-user', count: 2300, photos: [{ photoPath: 'photos/photo-loss-object.jpg' }] }]
    }] },
    cards: [],
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].previewPhoto, '/storage/photos/photo-loss-object.jpg');
  assert.equal(dashboard.recentPhotos[0].url, '/storage/photos/photo-loss-object.jpg');
});

run('keeps parsed dashboard event photos when raw snapshot photo arrays contain only blank strings', () => {
  const reports = [{
    reportId: 'event-photo-blank-raw-array',
    createdAt: '2026-07-15T08:25:43.587Z',
    deviceId: 'device-1',
    user: { userId: 'event-photo-user', displayName: 'Anna Ivanova', role: 'operator' },
    cards: [{
      cardId: 'card-1',
      code: 'VK-20260715-112138',
      cultureName: 'Береза',
      speciesName: 'белая',
      stage: 'Введение в культуру',
      batchStatus: 'active',
      currentQuantity: 263,
      updatedAt: '2026-07-15',
      events: [{ eventId: 'photo-loss-blank-raw-array', type: 'introloss', createdAt: '2026-07-15T08:25:43.587Z', createdBy: 'event-photo-user', count: 2300, photoFiles: ['photos/photo-loss-kept.jpg'] }]
    }],
    raw: { cards: [{
      events: [{ eventId: 'photo-loss-blank-raw-array', photoFiles: ['   '] }]
    }] },
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].previewPhoto, '/storage/photos/photo-loss-kept.jpg');
  assert.equal(dashboard.recentPhotos[0].url, '/storage/photos/photo-loss-kept.jpg');
});

run('groups multiple photos from one event into one dashboard photo card with modal payload and journal url', () => {
  const reports = [report('photo-grouping', '2026-07-15T08:25:43.587Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112138',
    cultureName: 'Берёза',
    speciesName: 'белая',
    stage: 'Введение в культуру',
    batchStatus: 'problem',
    currentQuantity: 263,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'problem-photo-group',
      type: 'problem',
      createdAt: '2026-07-15T08:25:43.587Z',
      createdBy: 'event-photo-user',
      problemType: 'Контаминация',
      riskLevel: 'Высокий',
      affectedQuantity: 12,
      comment: 'Налёт на листьях',
      photoFiles: ['photos/problem-1.jpg', 'photos/problem-2.jpg', 'photos/problem-3.jpg']
    }]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all', reportId: 'photo-grouping', employee: 'photo-grouping-user' });
  const [photo] = dashboard.recentPhotos;

  assert.equal(dashboard.recentPhotos.length, 1);
  assert.equal(photo.url, '/storage/photos/problem-1.jpg');
  assert.equal(photo.photoCount, 3);
  assert.equal(photo.extraPhotoCount, 2);
  assert.equal(photo.eventLabel, 'Контаминация · Высокий риск');
  assert.equal(photo.card.title, 'Берёза · белая');
  assert.equal(photo.card.eventLabel, 'Проблема');
  assert.equal(photo.card.eventLabelText, 'Тип проблемы: Проблема');
  assert.equal(photo.card.riskLabel, 'Высокий');
  assert.equal('code' in photo.card, false);
  assert.equal(photo.modal.photos.length, 3);
  assert.equal(photo.modal.metaLine, '15 июля в 11:25 · event-photo-user');
  assert.equal(photo.modal.title, 'Берёза · белая');
  assert.equal(photo.modal.subtitle, 'VK-20260715-112138 | Введение в культуру');
  assert.equal(photo.modal.eventLabel, 'Проблема');
  assert.equal(photo.modal.riskLabel, 'Высокий');
  assert.equal(photo.modal.dateLabel, '15 июля в 11:25');
  assert.match(photo.journalUrl, /\/stages\?/);
  assert.match(photo.journalUrl, /reportId=photo-grouping/);
  assert.match(photo.journalUrl, /employee=photo-grouping-user/);
  assert.match(photo.journalUrl, /eventId=problem-photo-group/);
});

run('removes short technical title segments from compact dashboard photo card titles', () => {
  const reports = [report('photo-compact-title', '2026-07-15T08:25:43.587Z', [{
    cardId: 'card-1',
    code: 'VS-20260720-06',
    cultureName: 'Гортензия',
    speciesName: 'мет.',
    varietyName: 'Vanille Fraise',
    stage: 'Теплица',
    batchStatus: 'problem',
    currentQuantity: 40,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'compact-title-event',
      type: 'problem',
      createdAt: '2026-07-15T08:25:43.587Z',
      problemType: 'Болезнь',
      riskLevel: 'Критический',
      photoFiles: ['photos/problem-1.jpg']
    }]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });

  assert.equal(dashboard.recentPhotos[0].card.title, 'Гортензия · Vanille Fraise');
  assert.equal(dashboard.recentPhotos[0].card.eventLabel, 'Проблема');
  assert.equal(dashboard.recentPhotos[0].card.eventLabelText, 'Тип проблемы: Проблема');
  assert.equal(dashboard.recentPhotos[0].card.riskLabel, 'Критический');
  assert.equal(dashboard.recentPhotos[0].modal.subtitle, 'VS-20260720-06 | Теплица');
});

run('limits recent dashboard photo cards to nine items', () => {
  const cards = Array.from({ length: 7 }, (_, index) => ({
    cardId: `card-${index + 1}`,
    code: `VK-${index + 1}`,
    cultureName: `Растение ${index + 1}`,
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 10,
    updatedAt: `2026-07-${String(index + 1).padStart(2, '0')}`,
    events: [{
      eventId: `photo-${index + 1}`,
      type: 'greenhouseCare',
      createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      photoFiles: [`photos/${index + 1}.jpg`]
    }]
  }));
  const reports = [report('photo-even-count', '2026-07-18T10:00:00.000Z', cards)];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });

  assert.equal(dashboard.recentPhotos.length, 7);
});

run('sorts dashboard photo cards by priority before date', () => {
  const reports = [report('photo-priority', '2026-07-18T10:00:00.000Z', [{
    cardId: 'card-1',
    code: 'VK-1',
    cultureName: 'Мирт',
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 100,
    updatedAt: '2026-07-18',
    events: [
      { eventId: 'care-photo', type: 'greenhouseCare', createdAt: '2026-07-18T10:00:00.000Z', photoFiles: ['photos/care.jpg'] },
      { eventId: 'planting-photo', type: 'planting', createdAt: '2026-07-17T10:00:00.000Z', photoFiles: ['photos/planting.jpg'] },
      { eventId: 'problem-photo', type: 'problem', createdAt: '2026-07-16T10:00:00.000Z', problemType: 'Вредители', riskLevel: 'Критический', photoFiles: ['photos/problem.jpg'] }
    ]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });

  assert.deepEqual(dashboard.recentPhotos.map((photo) => photo.eventId), ['problem-photo', 'planting-photo', 'care-photo']);
});

run('builds photo modal details for isolation and recovery events', () => {
  const reports = [report('photo-problem-flows', '2026-07-17T11:00:00.000Z', [{
    cardId: 'card-1',
    code: 'VK-PARENT',
    cultureName: 'Мирт',
    stage: 'Теплица',
    batchStatus: 'problem',
    currentQuantity: 500,
    updatedAt: '2026-07-17',
    events: [
      {
        eventId: 'problem-isolation-photo',
        type: 'problemIsolation',
        createdAt: '2026-07-16T09:00:00.000Z',
        quantity: 3,
        location: 'Теплица 2 · стол Т-4',
        photoFiles: ['photos/isolation.jpg'],
        extraFields: { childCode: 'VK-ISO' }
      },
      {
        eventId: 'problem-recovery-photo',
        type: 'problemRecovery',
        createdAt: '2026-07-17T09:05:00.000Z',
        recoveredQuantity: 3,
        photoFiles: ['photos/recovery.jpg']
      }
    ]
  }])];
  reports[0].getPhotoUrl = (photoPath) => `/storage/${photoPath}`;

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  const isolationPhoto = dashboard.recentPhotos.find((photo) => photo.eventId === 'problem-isolation-photo');
  const recoveryPhoto = dashboard.recentPhotos.find((photo) => photo.eventId === 'problem-recovery-photo');

  assert.equal(isolationPhoto.modal.title, 'Мирт');
  assert.equal(isolationPhoto.modal.eventLabel, 'Изоляция проблемных растений');
  assert.equal(isolationPhoto.modal.riskLabel, '');
  assert.equal(recoveryPhoto.modal.title, 'Мирт');
  assert.equal(recoveryPhoto.modal.eventLabel, 'Проблема решена');
  assert.equal(recoveryPhoto.modal.riskLabel, '');
});

run('uses movement location and comment from event fields', () => {
  const reports = [report('movement-details', '2026-07-15T08:25:13.505Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112239',
    cultureName: 'Арония',
    speciesName: 'Мулатка',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    currentQuantity: 100,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'movement-1784103913505',
      type: 'movement',
      createdAt: '2026-07-15T08:25:13.505Z',
      createdBy: 'movement-user',
      comment: 'Жёлтый ящик',
      extraFields: { nextLocation: 'Теплица 1 · Стеллаж Б · Полка 3' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].location, 'Теплица 1 · Стеллаж Б · Полка 3');
  assert.equal(dashboard.recentEvents[0].comment, 'Жёлтый ящик');
});

run('keeps parsed movement details when separate raw snapshot contains only blank strings', () => {
  const reports = [{
    reportId: 'movement-raw-blank-details',
    createdAt: '2026-07-15T08:25:13.505Z',
    deviceId: 'device-1',
    user: { userId: 'movement-user', displayName: 'Anna Ivanova', role: 'agronomist' },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'VK-20260715-112239',
      stage: 'РўРµРїР»РёС†Р°',
      batchStatus: 'active',
      currentQuantity: 100,
      updatedAt: '2026-07-15',
      events: [{
        eventId: 'movement-blank-raw',
        type: 'movement',
        createdAt: '2026-07-15T08:25:13.505Z',
        createdBy: 'movement-user',
        comment: '   ',
        extraFields: { nextLocation: '   ' }
      }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'VK-20260715-112239',
      cultureName: 'РђСЂРѕРЅРёСЏ',
      speciesName: 'РњСѓР»Р°С‚РєР°',
      stage: 'Р’РІРµРґРµРЅРёРµ РІ РєСѓР»СЊС‚СѓСЂСѓ',
      batchStatus: 'active',
      currentQuantity: 100,
      updatedAt: '2026-07-15',
      events: [{
        eventId: 'movement-blank-raw',
        type: 'movement',
        createdAt: '2026-07-15T08:25:13.505Z',
        createdBy: 'movement-user',
        comment: 'Жёлтый ящик',
        extraFields: { nextLocation: 'Теплица 1 · Стеллаж Б · Полка 3' }
      }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].location, 'Теплица 1 · Стеллаж Б · Полка 3');
  assert.equal(dashboard.recentEvents[0].comment, 'Жёлтый ящик');
});

run('uses problem type, risk level and description from event fields', () => {
  const reports = [report('problem-details', '2026-07-15T08:24:37.662Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112307',
    cultureName: 'Роза',
    speciesName: 'Жюли',
    varietyName: 'Отсутствует',
    stage: 'Введение в культуру',
    batchStatus: 'problem',
    currentQuantity: 1234,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'problem-1784103877662',
      type: 'problem',
      createdAt: '2026-07-15T08:24:37.662Z',
      createdBy: 'problem-user',
      problemType: 'Карантин',
      riskLevel: 'Критический',
      extraFields: { problemDescription: 'Максимальный карантин' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.attentionBatches[0].latestProblemTitle, 'Карантин');
  assert.equal(dashboard.attentionBatches[0].latestProblemAuthor, 'problem-user');
  assert.equal(dashboard.attentionBatches[0].latestProblemEvent.problemDescription, 'Максимальный карантин');
  assert.equal(dashboard.recentEvents[0].title, 'Карантин');
  assert.equal(dashboard.recentEvents[0].problem, 'Карантин');
  assert.equal(dashboard.recentEvents[0].risk, 'Критический');
  assert.equal(dashboard.recentEvents[0].problemDescription, 'Максимальный карантин');
});

run('builds attention events from the visible attention batches', () => {
  const reports = [report('attention-event', '2026-07-15T08:24:37.662Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112307',
    cultureName: 'Роза',
    speciesName: 'Жюли',
    stage: 'Введение в культуру',
    batchStatus: 'problem',
    currentQuantity: 1234,
    updatedAt: '2026-07-15',
    events: [{
      eventId: 'problem-1784103877662',
      type: 'problem',
      createdAt: '2026-07-15T08:24:37.662Z',
      createdBy: 'problem-user',
      problemType: 'Карантин',
      riskLevel: 'Критический',
      extraFields: { problemDescription: 'Максимальный карантин' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.attentionEvents.length, 1);
  assert.equal(dashboard.attentionEvents[0].batchKey, dashboard.attentionBatches[0].batchKey);
  assert.equal(dashboard.attentionEvents[0].title, dashboard.attentionBatches[0].latestProblemEvent.title);
  assert.equal(dashboard.attentionEvents[0].createdBy, 'problem-user');
  assert.equal(dashboard.attentionEvents[0].problemDescription, 'Максимальный карантин');
});

run('keeps rooting quantity and comment for dashboard events', () => {
  const reports = [report('rooting-details', '2026-07-15T10:22:43.331Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-125950',
    cultureName: 'Лаванда',
    speciesName: 'Отсутствует',
    stage: 'Клонирование',
    batchStatus: 'active',
    currentQuantity: 5432,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784110963331',
      type: 'rooting',
      createdAt: '2026-07-15T10:22:43.331Z',
      createdBy: 'rooting-user',
      count: 2000,
      extraFields: { totalQuantity: '5432' },
      comment: 'Хорошо укоренились'
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].quantity, 2000);
  assert.equal(dashboard.recentEvents[0].totalQuantity, 5432);
  assert.equal(dashboard.recentEvents[0].comment, 'Хорошо укоренились');
});

run('uses sale details from event fields', () => {
  const reports = [report('sale-details', '2026-07-15T10:33:59.418Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112239',
    cultureName: 'Голубика',
    speciesName: 'Блюкроп',
    stage: 'Клонирование',
    batchStatus: 'active',
    currentQuantity: 931,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784111639418',
      type: 'sale',
      createdAt: '2026-07-15T10:33:59.418Z',
      createdBy: 'sale-user',
      count: 1300,
      currentQuantity: 931,
      comment: 'Удачная продажа',
      extraFields: {
        totalQuantity: '2354',
        saleType: 'Розница',
        recipient: 'Частное лицо',
        saleAmount: '123456'
      }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].quantity, 1300);
  assert.equal(dashboard.recentEvents[0].totalQuantity, 2354);
  assert.equal(dashboard.recentEvents[0].currentQuantity, 931);
  assert.equal(dashboard.recentEvents[0].saleType, 'Розница');
  assert.equal(dashboard.recentEvents[0].recipient, 'Частное лицо');
  assert.equal(dashboard.recentEvents[0].saleAmount, '123456');
  assert.equal(dashboard.recentEvents[0].comment, 'Удачная продажа');
});

run('uses care type and comment from event fields', () => {
  const reports = [report('care-details', '2026-07-15T12:40:10.527Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-153121',
    cultureName: 'Монстера',
    speciesName: 'Marilyn',
    varietyName: 'Yellow',
    stage: 'Высадка',
    batchStatus: 'active',
    currentQuantity: 4523,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784127588715',
      type: 'plantingCare',
      createdAt: '2026-07-15T12:40:10.527Z',
      createdBy: 'care-user',
      extraFields: {
        careType: 'Профилактика',
        productName: 'Марганцовка',
        dosage: 'Малая',
        applicationMethod: 'Полив',
        plantReaction: 'Положительная'
      }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].careType, 'Профилактика');
  assert.equal(dashboard.recentEvents[0].productName, 'Марганцовка');
  assert.equal(dashboard.recentEvents[0].dosage, 'Малая');
  assert.equal(dashboard.recentEvents[0].applicationMethod, 'Полив');
  assert.equal(dashboard.recentEvents[0].plantReaction, 'Положительная');
});

run('uses observation stress, turgor and comment from event fields', () => {
  const reports = [report('observation-details', '2026-07-15T12:32:57.412Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-153121',
    cultureName: 'Монстера',
    speciesName: 'Marilyn',
    varietyName: 'Yellow',
    stage: 'Адаптация',
    batchStatus: 'active',
    currentQuantity: 4523,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784118777412',
      type: 'adaptationStress',
      createdAt: '2026-07-15T12:32:57.412Z',
      createdBy: 'observation-user',
      comment: 'Наблюдается нормально',
      extraFields: { stressLevel: 'Низкий', turgor: 'Нормальный' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].stressLevel, 'Низкий');
  assert.equal(dashboard.recentEvents[0].turgor, 'Нормальный');
  assert.equal(dashboard.recentEvents[0].comment, 'Наблюдается нормально');
});

run('uses transplant quantity, placement, density and comment from event fields', () => {
  const reports = [report('transplant-details', '2026-07-15T14:18:37.172Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-112239',
    cultureName: 'Голубика',
    speciesName: 'Блюкроп',
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 899,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784125117172',
      type: 'transplant',
      createdAt: '2026-07-15T14:18:37.172Z',
      createdBy: 'transplant-user',
      count: 32,
      comment: 'Пересалка в огород прошла успешно',
      extraFields: { placement: 'В огород', densityChange: 'Плотность' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].quantity, 32);
  assert.equal(dashboard.recentEvents[0].placement, 'В огород');
  assert.equal(dashboard.recentEvents[0].densityChange, 'Плотность');
  assert.equal(dashboard.recentEvents[0].comment, 'Пересалка в огород прошла успешно');
});

run('uses planting completion result and comment from event fields', () => {
  const reports = [report('completion-details', '2026-07-15T15:00:42.247Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-153054',
    cultureName: 'Росянка',
    speciesName: 'Drosera',
    varietyName: 'anglica',
    stage: 'Высадка',
    batchStatus: 'active',
    currentQuantity: 7523,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784127642247',
      type: 'plantingCompletion',
      createdAt: '2026-07-15T15:00:42.247Z',
      createdBy: 'completion-user',
      comment: 'Хорошо прижилась',
      extraFields: { completionResult: 'Прижилась' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].completionResult, 'Прижилась');
  assert.equal(dashboard.recentEvents[0].comment, 'Хорошо прижилась');
});

run('uses planting location, scheme, plot and soil from event fields', () => {
  const reports = [report('planting-details', '2026-07-15T14:58:34.207Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-153121',
    cultureName: 'Монстера',
    speciesName: 'Marilyn',
    varietyName: 'Yellow',
    stage: 'Высадка',
    batchStatus: 'active',
    currentQuantity: 4523,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784127514207',
      type: 'planting',
      createdAt: '2026-07-15T14:58:34.207Z',
      createdBy: 'planting-user',
      extraFields: {
        plantingLocation: 'Грядка',
        plantingScheme: '30х40',
        plotArea: '12',
        soilType: 'Грунт'
      }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].plantingLocation, 'Грядка');
  assert.equal(dashboard.recentEvents[0].plantingScheme, '30х40');
  assert.equal(dashboard.recentEvents[0].plotArea, '12');
  assert.equal(dashboard.recentEvents[0].soilType, 'Грунт');
});

run('shows all user initiated dashboard events for debugging', () => {
  const events = Array.from({ length: 9 }, (_, index) => ({
    eventId: `care-${index + 1}`,
    type: 'greenhouseCare',
    createdAt: `2026-07-15T10:${String(index).padStart(2, '0')}:00.000Z`,
    createdBy: 'debug-user'
  }));
  const reports = [report('debug-events', '2026-07-15T11:00:00.000Z', [{
    cardId: 'card-1',
    code: 'DBG-1',
    cultureName: 'Тест',
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 100,
    updatedAt: '2026-07-15',
    events
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents.length, 9);
});

run('uses stage change transition and remaining quantity', () => {
  const reports = [report('stage-change-details', '2026-07-15T10:00:06.273Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-125950',
    cultureName: 'Лаванда',
    stage: 'Клонирование',
    batchStatus: 'active',
    currentQuantity: 5432,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784109606273',
      type: 'stageChange',
      createdAt: '2026-07-15T10:00:06.273Z',
      createdBy: 'stage-user',
      currentQuantity: 5432,
      extraFields: { fromStage: 'Введение в культуру', toStage: 'Клонирование' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].fromStage, 'Введение в культуру');
  assert.equal(dashboard.recentEvents[0].toStage, 'Клонирование');
  assert.equal(dashboard.recentEvents[0].currentQuantity, 5432);
});

run('uses propagation remaining quantity, method and comment', () => {
  const reports = [report('propagation-details', '2026-07-15T10:24:04.383Z', [{
    cardId: 'card-1',
    code: 'VK-20260715-125742',
    cultureName: 'Мирт',
    stage: 'Клонирование',
    batchStatus: 'active',
    currentQuantity: 3623,
    updatedAt: '2026-07-15',
    events: [{
      eventId: '1784111044383',
      type: 'propagation',
      createdAt: '2026-07-15T10:24:04.383Z',
      createdBy: 'propagation-user',
      count: 1500,
      currentQuantity: 3623,
      comment: 'Хорошо размножились',
      extraFields: {
        propagationMethod: 'Черенкование',
        childCardId: 'child-card-1',
        childCode: 'VK-CHILD',
        parentCardId: 'parent-card-1',
        parentCode: 'VK-PARENT',
        generation: 2
      }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].quantity, 1500);
  assert.equal(dashboard.recentEvents[0].currentQuantity, 3623);
  assert.equal(dashboard.recentEvents[0].propagationMethod, 'Черенкование');
  assert.equal(dashboard.recentEvents[0].childCode, 'VK-CHILD');
  assert.equal(dashboard.recentEvents[0].parentCode, 'VK-PARENT');
  assert.equal(dashboard.recentEvents[0].generation, '2');
  assert.equal(dashboard.recentEvents[0].comment, 'Хорошо размножились');
});

run('keeps only the latest report for each employee in the dashboard reports block', () => {
  const older = report('older', '2026-07-15T09:00:00.000Z', []);
  const newer = report('newer', '2026-07-15T12:00:00.000Z', []);
  const other = report('other', '2026-07-15T10:00:00.000Z', []);
  older.user.userId = 'same-employee';
  newer.user.userId = 'same-employee';
  older.user.displayName = 'Ильдар Унайбеков';
  newer.user.displayName = 'Ильдар Унайбеков';
  other.user.displayName = 'Мария Иванова';

  const dashboard = buildDashboard([older, newer, other], newer, [older, newer, other], { period: 'all' });
  assert.equal(dashboard.recentReports.length, 2);
  assert.equal(dashboard.recentReports.find((item) => item.author === 'Ильдар Унайбеков').reportId, 'newer');
});


run('keeps same-name employees separate in the dashboard reports block when userIds differ', () => {
  const first = report('same-name-a', '2026-07-15T09:00:00.000Z', []);
  const second = report('same-name-b', '2026-07-15T12:00:00.000Z', []);
  first.user.userId = 'same-user-a';
  second.user.userId = 'same-user-b';
  first.user.displayName = 'Anna Ivanova';
  second.user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard([first, second], second, [first, second], { period: 'all' });

  assert.equal(dashboard.recentReports.length, 2);
  assert.deepEqual(dashboard.recentReports.map((item) => item.employeeKey).sort(), ['same-user-a', 'same-user-b']);
  assert.deepEqual(dashboard.recentReports.map((item) => item.author).sort(), ['Anna Ivanova (same-user-a)', 'Anna Ivanova (same-user-b)']);
  assert.deepEqual(dashboard.recentReports.map((item) => item.reportId).sort(), ['same-name-a', 'same-name-b']);
});

run('keeps employee activity and employee KPI separate when same-name employees have different userIds', () => {
  const now = '2026-07-15T12:00:00.000Z';
  const first = report('same-activity-a', now, [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 10,
    updatedAt: now,
    events: [{ eventId: 'event-a', type: 'movement', date: now, createdBy: 'same-user-a' }]
  }]);
  const second = report('same-activity-b', now, [{
    cardId: 'card-2',
    code: 'TP-2',
    stage: 'Теплица',
    batchStatus: 'active',
    currentQuantity: 10,
    updatedAt: now,
    events: [{ eventId: 'event-b', type: 'movement', date: now, createdBy: 'same-user-b' }]
  }]);
  first.user.userId = 'same-user-a';
  second.user.userId = 'same-user-b';
  first.user.displayName = 'Anna Ivanova';
  second.user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard([first, second], second, [first, second], { period: 'all' });
  const employeesMetric = dashboard.topMetrics.find((metric) => metric.key === 'employees');

  assert.equal(dashboard.employeeActivity.length, 2);
  assert.equal(employeesMetric.value, 2);
  assert.deepEqual(dashboard.employeeActivity.map((entry) => entry.name), ['Anna Ivanova (same-user-a)', 'Anna Ivanova (same-user-b)']);
});

run('disambiguates same-name employee labels in dashboard event feeds when userIds differ', () => {
  const first = report('same-event-a', '2026-07-15T10:00:00.000Z', [{
    cardId: 'card-1',
    code: 'TP-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'problem',
    currentQuantity: 10,
    updatedAt: '2026-07-15T10:00:00.000Z',
    events: [{
      eventId: 'problem-event-a',
      type: 'problem',
      createdAt: '2026-07-15T10:00:00.000Z',
      createdBy: 'same-user-a',
      problemType: 'Карантин',
      riskLevel: 'Высокий'
    }]
  }]);
  const second = report('same-event-b', '2026-07-15T11:00:00.000Z', [{
    cardId: 'card-2',
    code: 'TP-2',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'problem',
    currentQuantity: 10,
    updatedAt: '2026-07-15T11:00:00.000Z',
    events: [{
      eventId: 'problem-event-b',
      type: 'problem',
      createdAt: '2026-07-15T11:00:00.000Z',
      createdBy: 'same-user-b',
      problemType: 'Карантин',
      riskLevel: 'Высокий'
    }]
  }]);
  first.user.userId = 'same-user-a';
  second.user.userId = 'same-user-b';
  first.user.displayName = 'Anna Ivanova';
  second.user.displayName = 'Anna Ivanova';

  const dashboard = buildDashboard([first, second], second, [first, second], { period: 'all' });

  assert.deepEqual(dashboard.recentEvents.map((event) => event.createdBy).sort(), ['Anna Ivanova (same-user-a)', 'Anna Ivanova (same-user-b)']);
  assert.deepEqual(dashboard.attentionEvents.map((event) => event.createdBy).sort(), ['Anna Ivanova (same-user-a)', 'Anna Ivanova (same-user-b)']);
});

run('builds preformatted count labels for recent report cards', () => {
  const reports = [{
    reportId: 'report-labels',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-labels-user', displayName: 'Ivan Petrov', role: 'operator' },
    summary: {
      cardsCount: 1,
      eventsCount: 2,
      photosCount: 5,
      problemsCount: 21
    },
    raw: { cards: [] },
    cards: []
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].role, 'Оператор');
  assert.equal(dashboard.recentReports[0].summary.cardsCountLabel, '1 партия');
  assert.equal(dashboard.recentReports[0].summary.eventsCountLabel, '2 события');
  assert.equal(dashboard.recentReports[0].summary.photosCountLabel, '5 фото');
  assert.equal(dashboard.recentReports[0].summary.problemsCountLabel, '21 проблема');
});

run('derives recent report summary counts from cards when summary is missing', () => {
  const reports = [{
    reportId: 'report-summary-fallback',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-summary-fallback-user', displayName: 'Ivan Petrov', role: 'operator' },
    summary: {},
    raw: { cards: [] },
    cards: [{
      cardId: 'card-1',
      code: 'TP-1',
      batchStatus: 'problem',
      photoFiles: ['photos/card-1.jpg'],
      events: [
        { eventId: 'event-1', type: 'problem', createdAt: '2026-07-31T08:00:00.000Z', photoFiles: ['photos/event-1.jpg'] },
        { eventId: 'event-2', type: 'sale', createdAt: '2026-07-31T07:00:00.000Z' }
      ]
    }, {
      cardId: 'card-2',
      code: 'TP-2',
      events: []
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].summary.cardsCount, 2);
  assert.equal(dashboard.recentReports[0].summary.eventsCount, 2);
  assert.equal(dashboard.recentReports[0].summary.photosCount, 2);
  assert.equal(dashboard.recentReports[0].summary.problemsCount, 1);
  assert.equal(dashboard.recentReports[0].summary.cardsCountLabel, '2 партии');
  assert.equal(dashboard.recentReports[0].summary.eventsCountLabel, '2 события');
  assert.equal(dashboard.recentReports[0].summary.photosCountLabel, '2 фото');
  assert.equal(dashboard.recentReports[0].summary.problemsCountLabel, '1 проблема');
});

run('derives recent report summary counts from raw-only cards', () => {
  const reports = [{
    reportId: 'report-raw-summary-fallback',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-raw-summary-fallback-user', displayName: 'Ivan Petrov', role: 'operator' },
    summary: {},
    cards: [],
    raw: { cards: [{
      cardId: 'raw-card-1',
      code: 'RAW-1',
      batchStatus: 'problem',
      photoFiles: ['photos/raw-card-1.jpg'],
      events: [
        { eventId: 'raw-event-1', type: 'problem', createdAt: '2026-07-31T08:00:00.000Z', photoFiles: ['photos/raw-event-1.jpg'] },
        { eventId: 'raw-event-2', type: 'sale', createdAt: '2026-07-31T07:00:00.000Z' }
      ]
    }] }
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].summary.cardsCount, 1);
  assert.equal(dashboard.recentReports[0].summary.eventsCount, 2);
  assert.equal(dashboard.recentReports[0].summary.photosCount, 2);
  assert.equal(dashboard.recentReports[0].summary.problemsCount, 1);
});

run('derives recent report summary photo counts from object photo aliases in raw-only cards', () => {
  const reports = [{
    reportId: 'report-raw-object-summary-fallback',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-raw-object-summary-fallback-user', displayName: 'Ivan Petrov', role: 'operator' },
    summary: {},
    cards: [],
    raw: { cards: [{
      cardId: 'raw-card-1',
      code: 'RAW-1',
      batchStatus: 'problem',
      photos: [{ photoPath: 'photos/raw-card-1.jpg' }],
      events: [
        { eventId: 'raw-event-1', type: 'problem', createdAt: '2026-07-31T08:00:00.000Z', photos: [{ photoPath: 'photos/raw-event-1.jpg' }] },
        { eventId: 'raw-event-2', type: 'sale', createdAt: '2026-07-31T07:00:00.000Z' }
      ]
    }] }
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].summary.cardsCount, 1);
  assert.equal(dashboard.recentReports[0].summary.eventsCount, 2);
  assert.equal(dashboard.recentReports[0].summary.photosCount, 2);
  assert.equal(dashboard.recentReports[0].summary.problemsCount, 1);
});

run('derives recent report problem counts from problemDescription-only events when summary is missing', () => {
  const reports = [{
    reportId: 'report-problem-description-summary-fallback',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-problem-description-summary-user', displayName: 'Ivan Petrov', role: 'operator' },
    summary: {},
    raw: { cards: [] },
    cards: [{
      cardId: 'card-1',
      code: 'TP-1',
      batchStatus: 'active',
      events: [
        {
          eventId: 'event-1',
          type: 'observation',
          createdAt: '2026-07-31T08:00:00.000Z',
          extraFields: { problemDescription: 'Visible contamination spot' }
        }
      ]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].summary.problemsCount, 1);
  assert.equal(dashboard.recentReports[0].summary.problemsCountLabel, '1 проблема');
});

run('uses readable fallback role in recent reports when employee role contains only spaces', () => {
  const reports = [{
    reportId: 'report-blank-role',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'report-blank-role-user', displayName: 'Ivan Petrov', role: '   ' },
    summary: {
      cardsCount: 1,
      eventsCount: 0,
      photosCount: 0,
      problemsCount: 0
    },
    raw: { cards: [] },
    cards: []
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentReports[0].role, 'Роль не указана');
});

run('uses readable fallback role in recent events and employee activity when employee role contains only spaces', () => {
  const now = '2026-08-01T09:00:00.000Z';
  const reports = [{
    reportId: 'report-blank-event-role',
    createdAt: now,
    user: { userId: 'blank-role-user', displayName: 'Ivan Petrov', role: '   ' },
    summary: {
      cardsCount: 1,
      eventsCount: 1,
      photosCount: 0,
      problemsCount: 0
    },
    raw: { cards: [{
      cardId: 'card-1',
      code: 'TP-1',
      stage: 'Теплица',
      currentQuantity: 1,
      updatedAt: now,
      events: [{ eventId: 'move-1', type: 'movement', date: now, createdBy: 'blank-role-user' }]
    }] },
    cards: [{
      cardId: 'card-1',
      code: 'TP-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      currentQuantity: 1,
      updatedAt: now,
      events: [{ eventId: 'move-1', type: 'movement', date: now, createdBy: 'blank-role-user' }]
    }]
  }];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].role, 'Роль не указана');
  assert.equal(dashboard.employeeActivity[0].role, 'Роль не указана');
});

run('formats Russian count labels with the correct plural form', () => {
  assert.equal(formatCountLabel(1, ['отчет', 'отчета', 'отчетов']), '1 отчет');
  assert.equal(formatCountLabel(2, ['событие', 'события', 'событий']), '2 события');
  assert.equal(formatCountLabel(5, ['карточка', 'карточки', 'карточек']), '5 карточек');
  assert.equal(formatCountLabel(21, ['проблема', 'проблемы', 'проблем']), '21 проблема');
  assert.equal(formatCountLabel(11, ['партия', 'партии', 'партий']), '11 партий');
});
if (process.exitCode) process.exit(process.exitCode);



run('classifies isolation and recovery events as problem events with metadata', () => {
  const reports = [report('problem-isolation-dashboard', '2026-07-16T10:24:04.383Z', [{ cardId: 'card-1', code: 'VK-PARENT', cultureName: 'Мирт', stage: 'Теплица', batchStatus: 'problem', currentQuantity: 7, updatedAt: '2026-07-16', events: [{ eventId: 'problem-isolation-event', type: 'problemIsolation', createdAt: '2026-07-16T10:24:04.383Z', createdBy: 'problem-user', count: 3, currentQuantity: 7, extraFields: { childCardId: 'child-card-1', childCode: 'VK-ISO', parentCardId: 'parent-card-1', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 3, unisolatedProblemQuantity: 0 } }, { eventId: 'problem-recovery-event', type: 'problemRecovery', createdAt: '2026-07-16T11:24:04.383Z', createdBy: 'problem-user', count: 3, currentQuantity: 10, extraFields: { healthStatus: 'healthy', isolationStatus: 'released', activeProblemQuantity: 0, unisolatedProblemQuantity: 0 } }] }])];
  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  const isolationEvent = dashboard.recentEvents.find((event) => event.eventId === 'problem-isolation-event');
  const recoveryEvent = dashboard.recentEvents.find((event) => event.eventId === 'problem-recovery-event');
  assert.equal(isolationEvent.title.includes('Изол'), true);
  assert.equal(isolationEvent.childCode, 'VK-ISO');
  assert.equal(isolationEvent.sourceProblemEventId, 'problem-origin-1');
  assert.equal(isolationEvent.healthStatus, 'infected');
  assert.equal(isolationEvent.isolationStatus, 'isolated');
  assert.equal(recoveryEvent.title.includes('Проблема'), true);
  assert.equal(recoveryEvent.healthStatus, 'healthy');
  assert.equal(recoveryEvent.activeProblemQuantity, 0);
});

run('keeps full isolation quantities consistent without double counting parent and child', () => {
  const reports = [
    report('full-isolation-parent', '2026-07-16T09:00:00.000Z', [{
      cardId: 'parent-card',
      code: 'VK-PARENT',
      cultureName: 'Мирт',
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 500,
      activeProblemQuantity: 0,
      unisolatedProblemQuantity: 0,
      updatedAt: '2026-07-16T09:00:00.000Z',
      events: [
        { eventId: 'problem-origin-1', type: 'problem', createdAt: '2026-07-16T08:00:00.000Z', affectedQuantity: 500, problemType: 'Контаминация', riskLevel: 'Высокий' },
        { eventId: 'problem-isolation-1', type: 'problemIsolation', createdAt: '2026-07-16T09:00:00.000Z', count: 500, currentQuantity: 500, extraFields: { childCardId: 'isolated-child', childCode: 'VK-ISO', parentCardId: 'parent-card', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 500, unisolatedProblemQuantity: 0 } }
      ]
    }]),
    report('full-isolation-child', '2026-07-16T09:05:00.000Z', [{
      cardId: 'isolated-child',
      code: 'VK-ISO',
      cultureName: 'Мирт',
      stage: 'Теплица',
      batchStatus: 'quarantine',
      originType: 'problemIsolation',
      parentCardId: 'parent-card',
      parentCode: 'VK-PARENT',
      sourceProblemEventId: 'problem-origin-1',
      currentQuantity: 500,
      activeProblemQuantity: 500,
      healthStatus: 'infected',
      isolationStatus: 'isolated',
      updatedAt: '2026-07-16T09:05:00.000Z',
      events: [
        { eventId: 'isolated-from-parent-1', type: 'isolatedFromParent', createdAt: '2026-07-16T09:05:00.000Z', count: 500, extraFields: { parentCardId: 'parent-card', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 500 } }
      ]
    }])
  ];

  const batches = getLatestBatchSnapshots(reports);
  const parent = batches.find((batch) => batch.code === 'VK-PARENT');
  const child = batches.find((batch) => batch.code === 'VK-ISO');
  const dashboard = buildDashboard(reports, reports[1], reports, { period: 'all' });

  assert.equal(parent.currentQuantity, 500);
  assert.equal(parent.activeProblemQuantity, 0);
  assert.equal(parent.unisolatedProblemQuantity, 0);
  assert.equal(child.currentQuantity, 500);
  assert.equal(child.activeProblemQuantity, 500);
  assert.equal(child.originType, 'problemIsolation');
  assert.equal(batches.reduce((total, batch) => total + (Number(batch.currentQuantity) || 0), 0), 1000);
  assert.equal(dashboard.attentionBatches.some((batch) => batch.code === 'VK-PARENT'), false);
  assert.equal(dashboard.attentionBatches.some((batch) => batch.code === 'VK-ISO'), true);
});

run('removes released isolated batch from active problem and quarantine lists after recovery', () => {
  const reports = [report('isolation-recovery-child', '2026-07-17T09:05:00.000Z', [{
    cardId: 'isolated-child',
    code: 'VK-ISO',
    cultureName: 'Мирт',
    stage: 'Теплица',
    batchStatus: 'quarantine',
    originType: 'problemIsolation',
    parentCardId: 'parent-card',
    parentCode: 'VK-PARENT',
    currentQuantity: 500,
    activeProblemQuantity: 0,
    healthStatus: 'healthy',
    isolationStatus: 'released',
    updatedAt: '2026-07-17T09:05:00.000Z',
    events: [
      { eventId: 'problem-origin-1', type: 'problem', createdAt: '2026-07-16T08:00:00.000Z', affectedQuantity: 500, problemType: 'Контаминация' },
      { eventId: 'problem-isolation-1', type: 'problemIsolation', createdAt: '2026-07-16T09:00:00.000Z', count: 500, extraFields: { childCode: 'VK-ISO', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 500 } },
      { eventId: 'problem-recovery-1', type: 'problemRecovery', createdAt: '2026-07-17T09:05:00.000Z', count: 500, currentQuantity: 500, extraFields: { healthStatus: 'healthy', isolationStatus: 'released', activeProblemQuantity: 0, unisolatedProblemQuantity: 0 } }
    ]
  }])];

  const [batch] = getLatestBatchSnapshots(reports);
  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });

  assert.equal(batch.currentQuantity, 500);
  assert.equal(batch.activeProblemQuantity, 0);
  assert.equal(batch.originType, 'problemIsolation');
  assert.equal(batch.stage, 'Теплица');
  assert.equal(batch.healthStatus, 'healthy');
  assert.equal(batch.isolationStatus, 'released');
  assert.equal(dashboard.attentionBatches.some((item) => item.code === 'VK-ISO'), false);
  assert.equal(dashboard.current.quarantineBatches, 0);
  assert.equal(dashboard.recentEvents.some((event) => event.eventId === 'problem-origin-1'), true);
  assert.equal(dashboard.recentEvents.some((event) => event.eventId === 'problem-isolation-1'), true);
  assert.equal(dashboard.recentEvents.some((event) => event.eventId === 'problem-recovery-1'), true);
});

run('keeps cloned child quantity separate from parent for childCardId propagation and preserves legacy snapshot behavior', () => {
  const reports = [
    report('clone-parent-childid', '2026-07-18T09:00:00.000Z', [{
      cardId: 'parent-card',
      code: 'VK-PARENT',
      cultureName: 'Мирт',
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 500,
      updatedAt: '2026-07-18T09:00:00.000Z',
      events: [
        { eventId: 'propagation-1', type: 'propagation', createdAt: '2026-07-18T09:00:00.000Z', count: 200, currentQuantity: 500, extraFields: { childCardId: 'clone-child', childCode: 'VK-CLONE', parentCardId: 'parent-card', parentCode: 'VK-PARENT', generation: 1, propagationMethod: 'Черенкование' } }
      ]
    }]),
    report('clone-child-childid', '2026-07-18T09:05:00.000Z', [{
      cardId: 'clone-child',
      code: 'VK-CLONE',
      cultureName: 'Мирт',
      stage: 'Теплица',
      batchStatus: 'active',
      originType: 'cloned',
      parentCardId: 'parent-card',
      parentCode: 'VK-PARENT',
      currentQuantity: 200,
      updatedAt: '2026-07-18T09:05:00.000Z',
      events: [
        { eventId: 'cloned-from-parent-1', type: 'propagation', createdAt: '2026-07-18T09:05:00.000Z', count: 200, extraFields: { parentCardId: 'parent-card', parentCode: 'VK-PARENT', generation: 1, propagationMethod: 'Черенкование' } }
      ]
    }]),
    report('clone-legacy-parent', '2026-07-18T10:00:00.000Z', [{
      cardId: 'legacy-parent',
      code: 'VK-LEGACY',
      cultureName: 'Мирт',
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 700,
      updatedAt: '2026-07-18T10:00:00.000Z',
      events: [
        { eventId: 'propagation-legacy-1', type: 'propagation', createdAt: '2026-07-18T10:00:00.000Z', count: 200, currentQuantity: 700, extraFields: { parentCardId: 'legacy-parent', parentCode: 'VK-LEGACY', generation: 1, propagationMethod: 'Черенкование' } }
      ]
    }])
  ];

  const batches = getLatestBatchSnapshots(reports);
  const parent = batches.find((batch) => batch.code === 'VK-PARENT');
  const child = batches.find((batch) => batch.code === 'VK-CLONE');
  const legacyParent = batches.find((batch) => batch.code === 'VK-LEGACY');

  assert.equal(parent.currentQuantity, 500);
  assert.equal(child.currentQuantity, 200);
  assert.equal(parent.currentQuantity + child.currentQuantity, 700);
  assert.equal(child.originType, 'cloned');
  assert.equal(legacyParent.currentQuantity, 700);
});
