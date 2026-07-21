const assert = require('assert/strict');
const { buildReportDashboardModel } = require('../src/reportDashboardModel');

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

function buildReport() {
  const cards = [{
    cardId: 'card-1',
    code: 'VK-1',
    cultureName: 'Хризантема',
    speciesName: 'мультифлора',
    varietyName: 'Бордовая',
    stage: 'Клонирование',
    batchStatus: 'problem',
    currentQuantity: 80,
    updatedAt: '2026-07-15T12:00:00.000Z',
    photoFiles: ['photos/card.jpg'],
    events: [
      { eventId: 'sale-1', type: 'sale', count: 12, createdAt: '2026-07-15T10:00:00.000Z', createdBy: 'user-1' },
      { eventId: 'loss-1', type: 'death', count: 3, createdAt: '2026-07-15T11:00:00.000Z', createdBy: 'user-1' },
      { eventId: 'problem-1', type: 'problem', problemType: 'Карантин', riskLevel: 'Критический', createdAt: '2026-07-15T12:00:00.000Z', createdBy: 'user-1', photoFiles: ['photos/problem.jpg'] }
    ]
  }];
  return {
    reportId: 'report-one',
    createdAt: '2026-07-15T12:10:00.000Z',
    deviceId: 'device-1',
    user: { userId: 'user-1', displayName: 'Ильдар Унайбеков' },
    summary: { photosCount: 2 },
    raw: { cards },
    cards,
    getPhotoUrl: (path) => `/storage/${path}`
  };
}

run('builds a dashboard strictly from one imported report', () => {
  const dashboard = buildReportDashboardModel(buildReport());
  const values = Object.fromEntries(dashboard.topMetrics.map((metric) => [metric.key, metric.value]));

  assert.equal(values.cards, 1);
  assert.equal(values.events, 3);
  assert.equal(values.problems, 1);
  assert.equal(values.losses, 3);
  assert.equal(values.sales, 12);
  assert.equal(values.photos, 2);
  assert.equal(dashboard.recentEvents.length, 3);
  assert.equal(dashboard.attentionEvents[0].title, 'Карантин');
  assert.equal(dashboard.batches[0].events.length, 3);
  assert.equal(dashboard.recentPhotos.length, 2);
});

if (process.exitCode) process.exit(process.exitCode);
