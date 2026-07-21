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
  assert.equal(card.reportId, 'report-late');
});

run('selects a batch and journal tab from dashboard event query parameters', () => {
  const reports = [buildReport({ reportId: 'report-a', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a' })];
  const model = buildStagesPageModel(reports, { cardId: '1718000000000', tab: 'journal', eventId: 'event-a' });

  assert.equal(model.selectedCard.cardId, '1718000000000');
  assert.equal(model.selectedTab, 'journal');
  assert.equal(model.highlightedEventId, 'event-a');
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

if (process.exitCode) {
  process.exit(process.exitCode);
}
