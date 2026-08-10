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
    cultureName: '\u0425\u0440\u0438\u0437\u0430\u043d\u0442\u0435\u043c\u0430',
    speciesName: '\u043c\u0443\u043b\u044c\u0442\u0438\u0444\u043b\u043e\u0440\u0430',
    varietyName: '\u0411\u043e\u0440\u0434\u043e\u0432\u0430\u044f',
    stage: '\u041a\u043b\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',
    batchStatus: 'problem',
    currentQuantity: 80,
    updatedAt: '2026-07-15T12:00:00.000Z',
    photoFiles: ['photos/card.jpg'],
    events: [
      { eventId: 'sale-1', type: 'sale', count: 12, createdAt: '2026-07-15T10:00:00.000Z', createdBy: 'user-1' },
      { eventId: 'loss-1', type: 'death', count: 3, createdAt: '2026-07-15T11:00:00.000Z', createdBy: 'user-1' },
      {
        eventId: 'problem-1',
        type: 'problem',
        problemType: '\u041a\u0430\u0440\u0430\u043d\u0442\u0438\u043d',
        riskLevel: '\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439',
        createdAt: '2026-07-15T12:00:00.000Z',
        createdBy: 'user-1',
        photoFiles: ['photos/problem.jpg']
      }
    ]
  }];

  return {
    reportId: 'report-one',
    createdAt: '2026-07-15T12:10:00.000Z',
    deviceId: 'device-1',
    user: { userId: 'user-1', displayName: '\u0418\u043b\u044c\u0434\u0430\u0440 \u0423\u043d\u0430\u0439\u0431\u0435\u043a\u043e\u0432' },
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
  assert.equal(dashboard.attentionEvents[0].batchKey, dashboard.batches[0].batchKey);
  assert.equal(dashboard.attentionEvents[0].cardId, 'card-1');
  assert.equal(dashboard.batches[0].events.length, 3);
  assert.equal(dashboard.recentPhotos.length, 2);
});

run('falls back to merged report photos when summary photos count is missing', () => {
  const report = buildReport();
  delete report.summary.photosCount;

  const dashboard = buildReportDashboardModel(report);
  const values = Object.fromEntries(dashboard.topMetrics.map((metric) => [metric.key, metric.value]));

  assert.equal(values.photos, 2);
  assert.equal(dashboard.summary.photosCount, 2);
  assert.equal(dashboard.recentPhotos.length, 2);
});

run('keeps explicit zero summary photos count', () => {
  const report = buildReport();
  report.summary.photosCount = 0;

  const dashboard = buildReportDashboardModel(report);
  const values = Object.fromEntries(dashboard.topMetrics.map((metric) => [metric.key, metric.value]));

  assert.equal(values.photos, 0);
  assert.equal(dashboard.summary.photosCount, 0);
  assert.equal(dashboard.recentPhotos.length, 2);
});

run('uses employee name for batch photos in report dashboard gallery', () => {
  const dashboard = buildReportDashboardModel(buildReport());
  const batchPhoto = dashboard.recentPhotos.find((photo) => photo.eventTitle === '\u0424\u043e\u0442\u043e \u043f\u0430\u0440\u0442\u0438\u0438');

  assert.ok(batchPhoto);
  assert.equal(batchPhoto.createdBy, dashboard.employee.name);
});

run('supports singular and object photo aliases in report dashboard gallery', () => {
  const pathReport = buildReport();
  delete pathReport.summary.photosCount;
  delete pathReport.raw.cards[0].photoFiles;
  delete pathReport.cards[0].photoFiles;
  pathReport.raw.cards[0].photoPath = 'photos/card-path.jpg';
  pathReport.cards[0].photoPath = 'photos/card-path.jpg';

  const pathDashboard = buildReportDashboardModel(pathReport);
  const pathPhoto = pathDashboard.recentPhotos.find((photo) => photo.url === '/storage/photos/card-path.jpg');
  assert.ok(pathPhoto);
  assert.equal(pathPhoto.eventTitle, '\u0424\u043e\u0442\u043e \u043f\u0430\u0440\u0442\u0438\u0438');

  const objectReport = buildReport();
  delete objectReport.summary.photosCount;
  delete objectReport.raw.cards[0].photoFiles;
  delete objectReport.cards[0].photoFiles;
  objectReport.raw.cards[0].photos = [{ photoPath: 'photos/card-object-path.jpg' }];
  objectReport.cards[0].photos = [{ photoPath: 'photos/card-object-path.jpg' }];

  const objectDashboard = buildReportDashboardModel(objectReport);
  const objectPhoto = objectDashboard.recentPhotos.find((photo) => photo.url === '/storage/photos/card-object-path.jpg');
  assert.ok(objectPhoto);
  assert.equal(objectPhoto.eventTitle, '\u0424\u043e\u0442\u043e \u043f\u0430\u0440\u0442\u0438\u0438');
});

run('uses readable employee and import fallbacks when report metadata is missing', () => {
  const report = buildReport();
  delete report.user;
  delete report.createdAt;
  report.author = '';
  report.userName = '';

  const dashboard = buildReportDashboardModel(report);

  assert.equal(dashboard.employee.name, '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
  assert.equal(dashboard.employee.role, '\u0420\u043e\u043b\u044c \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u0430');
  assert.equal(dashboard.importDate, '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e');
  assert.equal(dashboard.importTime, '\u2014');
});

run('falls back to report author when employee display name contains only spaces', () => {
  const report = buildReport();
  report.user.displayName = '   ';
  report.author = 'Anna Ivanova';

  const dashboard = buildReportDashboardModel(report);

  assert.equal(dashboard.employee.name, 'Anna Ivanova');
});

run('uses readable fallback role when employee role contains only spaces', () => {
  const report = buildReport();
  report.user.role = '   ';

  const dashboard = buildReportDashboardModel(report);

  assert.equal(dashboard.employee.role, '\u0420\u043e\u043b\u044c \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u0430');
});

run('translates known employee roles to Russian', () => {
  const report = buildReport();
  report.user.role = 'greenhouse';

  const dashboard = buildReportDashboardModel(report);

  assert.equal(dashboard.employee.role, '\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a \u0442\u0435\u043f\u043b\u0438\u0446\u044b');
});

if (process.exitCode) process.exit(process.exitCode);
