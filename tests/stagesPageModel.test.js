const assert = require('assert/strict');
const { buildBatchCatalog, buildStagesPageModel } = require('../src/stagesPageModel');

function buildReport({ reportId, deviceId, updatedAt, quantity, eventId }) {
  const card = {
    cardId: '1718000000000',
    code: 'VK-20260610-120000',
    cultureName: 'Тестовая культура',
    speciesName: 'Тестовый вид',
    varietyName: 'Тестовый сорт',
    stage: 'Введение в культуру',
    batchStatus: 'active',
    quantity: 10,
    currentQuantity: quantity,
    createdAt: '2026-06-10T08:00:00.000Z',
    updatedAt,
    events: [{ eventId, type: 'comment', title: 'Проверка', createdAt: updatedAt }],
  };

  return {
    reportId,
    deviceId,
    createdAt: updatedAt,
    raw: { cards: [card] },
    cards: [card],
  };
}

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

run('keeps equal cardId values from different devices as separate batches', () => {
  const reports = [
    buildReport({ reportId: 'report-a', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a' }),
    buildReport({ reportId: 'report-b', deviceId: 'device-b', updatedAt: '2026-06-10T10:00:00.000Z', quantity: 8, eventId: 'event-b' }),
  ];
  const cards = buildBatchCatalog(reports);

  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].batchKey, cards[1].batchKey);
  assert.ok(!cards[0].batchKey.includes('\u0000'));

  const browserBatchId = decodeURIComponent(encodeURIComponent(cards[1].batchKey));
  const model = buildStagesPageModel(reports, { batchId: browserBatchId });
  assert.equal(model.selectedCard.deviceId, cards[1].deviceId);
  assert.equal(model.selectedCard.currentQuantity, cards[1].currentQuantity);
});

run('merges snapshots only when deviceId and cardId match', () => {
  const reports = [
    buildReport({ reportId: 'report-a1', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a1' }),
    buildReport({ reportId: 'report-a2', deviceId: 'device-a', updatedAt: '2026-06-10T10:00:00.000Z', quantity: 8, eventId: 'event-a2' }),
  ];
  const [card] = buildBatchCatalog(reports);

  assert.equal(buildBatchCatalog(reports).length, 1);
  assert.equal(card.currentQuantity, 8);
  assert.deepEqual(card.events.map((event) => event.eventId).sort(), ['event-a1', 'event-a2']);
});

run('prefers the newer report timestamp when same-day card snapshots have date-only updatedAt', () => {
  const earlier = buildReport({ reportId: 'report-early', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'event-early' });
  earlier.raw.cards[0].updatedAt = '2026-07-15';
  earlier.raw.cards[0].createdAt = '2026-07-15';
  earlier.raw.cards[0].batchStatus = 'active';
  earlier.cards[0].updatedAt = '2026-07-15';
  earlier.cards[0].createdAt = '2026-07-15';
  earlier.cards[0].batchStatus = 'active';

  const later = buildReport({ reportId: 'report-late', deviceId: 'device-a', updatedAt: '2026-07-15T15:00:00.000Z', quantity: 8, eventId: 'event-late' });
  later.raw.cards[0].updatedAt = '2026-07-15';
  later.raw.cards[0].createdAt = '2026-07-15';
  later.raw.cards[0].batchStatus = 'quarantine';
  later.cards[0].updatedAt = '2026-07-15';
  later.cards[0].createdAt = '2026-07-15';
  later.cards[0].batchStatus = 'quarantine';

  const [card] = buildBatchCatalog([earlier, later]);
  assert.equal(card.status, 'quarantine');
  assert.equal(card.statusLabel, 'Карантин');
  assert.equal(card.reportId, 'report-late');
});

run('selects a batch and journal tab from dashboard event query parameters', () => {
  const reports = [buildReport({ reportId: 'report-a', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a' })];
  const model = buildStagesPageModel(reports, { cardId: '1718000000000', tab: 'journal', eventId: 'event-a' });

  assert.equal(model.selectedCard.cardId, '1718000000000');
  assert.equal(model.selectedTab, 'journal');
  assert.equal(model.highlightedEventId, 'event-a');
});

run('uses journal as the default batch details tab', () => {
  const reports = [buildReport({ reportId: 'report-default-tab', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a' })];

  assert.equal(buildStagesPageModel(reports, {}).selectedTab, 'journal');
  assert.equal(buildStagesPageModel(reports, { tab: 'calendar' }).selectedTab, 'journal');
  assert.equal(buildStagesPageModel(reports, { tab: 'passport' }).selectedTab, 'passport');
});

run('uses application passport labels for active status and quantity', () => {
  const report = buildReport({ reportId: 'report-passport-labels', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 7, eventId: 'event-a' });
  report.raw.cards[0].quantity = 10;

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.statusLabel, 'Без отклонений');
  assert.equal(card.totalQuantityLabel, '7 из 10 шт.');
  assert.equal(card.qrStatusLabel, 'Ожидает печати');
  assert.equal(Number.isInteger(card.daysInStage), true);
});

run('uses human-readable event type labels in batch journal', () => {
  const report = buildReport({ reportId: 'report-event-labels', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'problem-a' });
  report.user = { userId: 'local-user', displayName: 'Ильдар Унайбеков' };
  report.raw.cards[0].events = [
    {
      eventId: 'problem-a',
      type: 'problem',
      createdAt: '2026-07-15T09:00:00.000Z',
      createdBy: 'local-user',
      affectedQuantity: 100,
      problemType: 'Контаминация',
      riskLevel: 'Низкий',
      extraFields: { problemDescription: 'Заражение микробами' }
    },
    { eventId: 'created-a', type: 'batchCreated', createdAt: '2026-07-15T08:00:00.000Z' }
  ];

  const model = buildStagesPageModel([report], {});

  assert.deepEqual(model.cards[0].events.map((event) => event.typeLabel), ['Проблема', 'Создание партии']);
  assert.equal(model.cards[0].events[0].createdBy, 'Ильдар Унайбеков');
  assert.deepEqual(model.cards[0].events[0].details, [
    { label: 'Затронуто', value: '100 шт.' },
    { label: 'Тип проблемы', value: 'Контаминация' },
    { label: 'Риск', value: 'Низкий' },
    { label: 'Описание', value: 'Заражение микробами' }
  ]);
});

run('adds application details for batch created events using card quantity fallback', () => {
  const report = buildReport({ reportId: 'report-created-details', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'created-a' });
  report.raw.cards[0].events = [
    {
      eventId: 'created-a',
      type: 'batchCreated',
      title: 'Создание партии',
      createdAt: '2026-07-15T08:00:00.000Z',
      stage: 'Введение в культуру',
      count: 0,
      currentQuantity: 0,
      qrStatus: 'pending_print'
    }
  ];

  const [card] = buildBatchCatalog([report]);

  assert.deepEqual(card.events[0].details, [
    { label: 'Стадия', value: 'Введение в культуру' },
    { label: 'Количество', value: '10 шт.' },
    { label: 'QR', value: 'Ожидает печати' }
  ]);
});

run('adds application details for rooting events from report fields', () => {
  const report = buildReport({ reportId: 'report-rooting-details', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 1828, eventId: 'rooting-a' });
  report.raw.cards[0].events = [
    {
      eventId: 'rooting-a',
      type: 'rooting',
      title: 'Укоренение',
      createdAt: '2026-07-15T08:00:00.000Z',
      count: 1828,
      extraFields: {
        totalQuantity: 1828,
        rootingPercent: 100
      }
    }
  ];

  const [card] = buildBatchCatalog([report]);

  assert.deepEqual(card.events[0].details, [
    { label: 'Количество', value: '1828 из 1828 шт.' },
    { label: 'Процент укоренения', value: '100%' }
  ]);
});

run('adds application details for hardening observation readiness', () => {
  const report = buildReport({ reportId: 'report-observation-details', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 1330, eventId: 'observation-a' });
  report.raw.cards[0].events = [
    {
      eventId: 'observation-a',
      type: 'hardeningObservation',
      title: 'Наблюдение',
      createdAt: '2026-07-15T08:00:00.000Z',
      extraFields: {
        totalQuantity: 1330,
        readinessForPlanting: 'Готова'
      }
    }
  ];

  const [card] = buildBatchCatalog([report]);

  assert.deepEqual(card.events[0].details, [
    { label: 'Готовность к высадке', value: 'Готова' }
  ]);
});

run('adds comments to batch journal details with a label', () => {
  const report = buildReport({ reportId: 'report-comment-details', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'movement-a' });
  report.raw.cards[0].events = [
    {
      eventId: 'movement-a',
      type: 'movement',
      title: 'Перемещение',
      createdAt: '2026-07-15T08:00:00.000Z',
      comment: 'В углу в зелёном ящике',
      extraFields: {
        nextLocation: 'Теплица 1 · Стеллаж П · Полка 3'
      }
    }
  ];

  const [card] = buildBatchCatalog([report]);

  assert.deepEqual(card.events[0].details, [
    { label: 'Куда', value: 'Теплица 1 · Стеллаж П · Полка 3' },
    { label: 'Комментарий', value: 'В углу в зелёном ящике' }
  ]);
});

run('hides technical missing plant names from batch titles', () => {
  const report = buildReport({ reportId: 'report-missing-name', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'event-name' });
  report.raw.cards[0].cultureName = 'Арония';
  report.raw.cards[0].speciesName = 'Мулатка';
  report.raw.cards[0].varietyName = 'Отсутствует';
  report.cards[0].cultureName = 'Арония';
  report.cards[0].speciesName = 'Мулатка';
  report.cards[0].varietyName = 'Отсутствует';

  const [card] = buildBatchCatalog([report]);
  assert.equal(card.title, 'Арония · Мулатка');
  assert.equal(card.variety, '');
});

run('keeps clone origin and related propagation fields in batch model', () => {
  const report = buildReport({ reportId: 'report-clone', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'propagation-event' });
  Object.assign(report.raw.cards[0], {
    originType: 'cloned',
    parentCardId: 'parent-card-1',
    parentCode: 'VK-PARENT',
    generation: 2,
    propagatedAt: '2026-07-15T09:00:00.000Z',
    propagationMethod: 'Черенкование',
    activeProblemQuantity: 3,
    healthyQuantity: 9,
    events: [{
      eventId: 'propagation-event',
      type: 'propagation',
      createdAt: '2026-07-15T09:00:00.000Z',
      count: 12,
      childCardId: 'child-card-1',
      childCode: 'VK-CHILD',
      parentCardId: 'parent-card-1',
      parentCode: 'VK-PARENT',
      generation: 2,
      propagationMethod: 'Черенкование'
    }]
  });
  report.cards[0] = { ...report.raw.cards[0] };

  const [card] = buildBatchCatalog([report]);
  assert.equal(card.originType, 'cloned');
  assert.equal(card.parentCode, 'VK-PARENT');
  assert.equal(card.generation, 2);
  assert.equal(card.propagationMethod, 'Черенкование');
  assert.equal(card.activeProblemQuantity, 3);
  assert.equal(card.healthyQuantity, 9);
  assert.equal(card.events[0].childCode, 'VK-CHILD');
  assert.equal(card.events[0].parentCode, 'VK-PARENT');
});

run('filters batches by the employee who submitted their latest snapshot', () => {
  const first = buildReport({ reportId: 'report-first', deviceId: 'device-first', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'employee-first' });
  first.user = { userId: 'anna', displayName: 'Анна Иванова' };
  const second = buildReport({ reportId: 'report-second', deviceId: 'device-second', updatedAt: '2026-07-15T10:00:00.000Z', quantity: 8, eventId: 'employee-second' });
  second.user = { userId: 'petr', displayName: 'Пётр Петров' };

  const model = buildStagesPageModel([first, second], { employee: 'anna' });
  assert.equal(model.selectedEmployee, 'anna');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeName, 'Анна Иванова');
  assert.deepEqual(model.employees.map((employee) => employee.label), ['Все сотрудники', 'Анна Иванова', 'Пётр Петров']);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
