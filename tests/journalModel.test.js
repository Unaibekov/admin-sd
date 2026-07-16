const assert = require('assert/strict');
const {
  buildJournalPageModel,
  buildGlobalJournal,
  filterJournalEvents,
  getEventCategory,
  groupEventsByDate
} = require('../src/journalPageModel');

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

const card = { cardId: 'card-1', code: 'TP-0041', cultureName: 'Монстера', speciesName: 'Monstera deliciosa', varietyName: 'Borsigiana', stage: 'Теплица', updatedAt: '2026-06-19T15:00:00.000Z' };
const reports = [
  { reportId: 'snapshot-old', createdAt: '2026-06-18T12:00:00.000Z', cards: [{ ...card, events: [{ eventId: 'event-1', type: 'greenhouseCare', date: '2026-06-18T10:00:00.000Z', createdBy: 'Павел Соколов' }, { eventId: 'event-2', type: 'problem', date: '2026-06-18T11:00:00.000Z', createdBy: 'Павел Соколов', problemType: 'Вредители' }] }], raw: { cards: [{ events: [{ eventId: 'event-1' }, { eventId: 'event-2' }] }] } },
  { reportId: 'snapshot-new', createdAt: '2026-06-19T12:00:00.000Z', cards: [{ ...card, events: [{ eventId: 'event-1', type: 'greenhouseCare', date: '2026-06-18T10:00:00.000Z', createdBy: 'Павел Соколов' }, { eventId: 'event-3', type: 'sale', date: '2026-06-19T11:00:00.000Z', createdBy: 'Анна Иванова', count: 24, previousQuantity: 112, currentQuantity: 88 }] }], raw: { cards: [{ events: [{ eventId: 'event-1' }, { eventId: 'event-3' }] }] } }
];

run('deduplicates an event that repeats in snapshots by eventId', () => {
  const events = buildGlobalJournal(reports);
  assert.equal(events.length, 3);
  assert.equal(events.filter((event) => event.id === 'event-1').length, 1);
});

run('filters global events jointly by employee, category, stage and search', () => {
  const events = buildGlobalJournal(reports);
  const filtered = filterJournalEvents(events, { period: 'all', employee: 'Анна Иванова', category: 'sales', stage: 'Теплица', query: 'TP-0041', quick: 'all' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'event-3');
});

run('sums the number of plants in loss and sale operations for the journal summary', () => {
  const journal = buildJournalPageModel([{
    reportId: 'quantity-report',
    cards: [{ ...card, events: [
      { eventId: 'loss-1', type: 'death', date: '2026-06-19T10:00:00.000Z', count: 3 },
      { eventId: 'loss-2', type: 'loss', date: '2026-06-19T10:30:00.000Z', quantity: 6 },
      { eventId: 'sale-1', type: 'sale', date: '2026-06-19T11:00:00.000Z', count: 24 }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'loss-1' }, { eventId: 'loss-2' }, { eventId: 'sale-1' }] }] }
  }]);
  assert.equal(journal.summary.lostPlants, 9);
  assert.equal(journal.summary.soldPlants, 24);
});

run('uses documented operation types for categories and chronological groups', () => {
  const events = buildGlobalJournal(reports);
  assert.equal(getEventCategory({ type: 'greenhouseCare' }), 'care');
  assert.equal(getEventCategory({ type: 'plantingCompletion' }), 'completion');
  assert.equal(groupEventsByDate(events).length, 2);
});

run('uses the report employee name instead of a technical createdBy identifier', () => {
  const events = buildGlobalJournal([{
    reportId: 'employee-report',
    createdAt: '2026-06-19T12:00:00.000Z',
    user: { userId: 'demo-user-001', displayName: 'Иван Петров' },
    cards: [{ ...card, events: [{ eventId: 'employee-event', type: 'greenhouseCare', date: '2026-06-19T11:00:00.000Z', createdBy: 'demo-user-001' }] }],
    raw: { cards: [{ events: [{ eventId: 'employee-event' }] }] }
  }]);
  assert.equal(events[0].createdBy, 'Иван Петров');
});

run('uses the report employee name for local app user events', () => {
  const events = buildGlobalJournal([{
    reportId: 'local-user-report',
    createdAt: '2026-07-15T05:55:10.709Z',
    user: { userId: 'ildar-unaybekov', displayName: 'Ильдар Унайбеков' },
    cards: [{ ...card, events: [{ eventId: 'local-user-event', type: 'introloss', date: '2026-07-15T00:00:00.000Z', createdBy: 'local-user', count: 255 }] }],
    raw: { cards: [{ events: [{ eventId: 'local-user-event' }] }] }
  }]);
  assert.equal(events[0].createdBy, 'Ильдар Унайбеков');
});

run('uses the report employee name when event author is technical unknown', () => {
  const events = buildGlobalJournal([{
    reportId: 'unknown-author-report',
    createdAt: '2026-07-15T12:44:41.849Z',
    user: { userId: 'ildar-unaybekov', displayName: 'Ильдар Унайбеков' },
    cards: [{ ...card, events: [{ eventId: 'stage-unknown', type: 'stageChange', date: '2026-07-15T12:43:57.694Z', createdBy: 'Неизвестно' }] }],
    raw: { cards: [{ events: [{ eventId: 'stage-unknown' }] }] }
  }]);
  assert.equal(events[0].createdBy, 'Ильдар Унайбеков');
});

run('hides technical missing plant names from journal events', () => {
  const events = buildGlobalJournal([{
    reportId: 'missing-plant-name',
    cards: [{
      ...card,
      cultureName: 'Арония',
      speciesName: 'Мулатка',
      varietyName: 'Отсутствует',
      events: [{ eventId: 'move-1', type: 'movement', date: '2026-07-15T09:00:00.000Z' }]
    }],
    raw: { cards: [{ events: [{ eventId: 'move-1' }] }] }
  }]);
  assert.equal(events[0].culture, 'Арония · Мулатка');
});

run('uses event createdAt time when date contains only the day', () => {
  const events = buildGlobalJournal([{
    reportId: 'event-time',
    cards: [{
      ...card,
      updatedAt: '2026-07-15',
      events: [{ eventId: 'loss-time', type: 'introloss', date: '2026-07-15', createdAt: '2026-07-15T05:54:42.672Z', count: 255 }]
    }],
    raw: { cards: [{ events: [{ eventId: 'loss-time' }] }] }
  }]);
  assert.equal(events[0].date, '2026-07-15T05:54:42.672Z');
  assert.equal(events[0].timeLabel, '08:54');
});

run('excludes only automatically generated records from the user journal', () => {
  const events = buildGlobalJournal([{
    reportId: 'plant-events-only',
    cards: [{ ...card, events: [
      { eventId: 'created', type: 'batchCreated', date: '2026-06-19T08:00:00.000Z' },
      { eventId: 'qr', type: 'qrGenerated', date: '2026-06-19T08:01:00.000Z' },
      { eventId: 'stage', type: 'stageChange', date: '2026-06-19T08:02:00.000Z' },
      { eventId: 'move', type: 'movement', date: '2026-06-19T08:03:00.000Z' },
      { eventId: 'care', type: 'greenhouseCare', date: '2026-06-19T08:04:00.000Z' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'created' }, { eventId: 'qr' }, { eventId: 'stage' }, { eventId: 'move' }, { eventId: 'care' }] }] }
  }]);
  assert.deepEqual(events.map((event) => event.id), ['care', 'move', 'stage']);
});

if (process.exitCode) process.exit(process.exitCode);
