const assert = require('assert/strict');
const { buildCurrentDashboardSnapshot, buildDashboard } = require('../src/dashboardModel');

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
  assert.equal(dashboard.recentEvents[0].title, 'Карантин');
  assert.equal(dashboard.recentEvents[0].problem, 'Карантин');
  assert.equal(dashboard.recentEvents[0].risk, 'Критический');
  assert.equal(dashboard.recentEvents[0].problemDescription, 'Максимальный карантин');
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
      extraFields: { propagationMethod: 'Черенкование' }
    }]
  }])];

  const dashboard = buildDashboard(reports, reports[0], reports, { period: 'all' });
  assert.equal(dashboard.recentEvents[0].quantity, 1500);
  assert.equal(dashboard.recentEvents[0].currentQuantity, 3623);
  assert.equal(dashboard.recentEvents[0].propagationMethod, 'Черенкование');
  assert.equal(dashboard.recentEvents[0].comment, 'Хорошо размножились');
});

if (process.exitCode) process.exit(process.exitCode);
