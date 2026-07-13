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

if (process.exitCode) {
  process.exit(process.exitCode);
}
