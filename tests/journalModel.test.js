const assert = require('assert/strict');
const {
  buildJournalPageModel,
  buildGlobalJournal,
  filterJournalEvents,
  getEventCategory,
  groupEventsByDate
} = require('../src/journalPageModel');
const { buildJournalModel } = require('../src/journalModel');

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

run('deduplicates repeated global events when raw snapshot omits eventId but parsed snapshot keeps it', () => {
  const repeated = buildGlobalJournal([{
    reportId: 'snapshot-a',
    createdAt: '2026-07-15T09:00:00.000Z',
    user: { userId: 'user-1', displayName: 'Anna Ivanova' },
    cards: [{ ...card, events: [{ eventId: 'same-event', type: 'movement', date: '2026-07-15T08:00:00.000Z', comment: 'Old comment', createdBy: 'user-1' }] }],
    raw: { cards: [{ events: [{}] }] }
  }, {
    reportId: 'snapshot-b',
    createdAt: '2026-07-16T09:00:00.000Z',
    user: { userId: 'user-1', displayName: 'Anna Ivanova' },
    cards: [{ ...card, events: [{ eventId: 'same-event', type: 'movement', date: '2026-07-15T08:00:00.000Z', comment: 'New comment', createdBy: 'user-1' }] }],
    raw: { cards: [{ events: [{}] }] }
  }]);

  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].id, 'same-event');
  assert.equal(repeated[0].sourceEventId, 'same-event');
  assert.equal(repeated[0].comment, 'New comment');
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

run('groups consecutive global journal events by batch with shared meta', () => {
  const journal = buildJournalPageModel([{
    reportId: 'event-meta-report',
    cards: [{ ...card, quantity: 112, currentQuantity: 88, createdAt: '2026-06-10T08:00:00.000Z', events: [
      { eventId: 'move-1', type: 'movement', date: '2026-06-19T10:00:00.000Z', nextLocation: 'Теплица 1' },
      { eventId: 'sale-1', type: 'sale', date: '2026-06-19T11:00:00.000Z', count: 24 }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'move-1' }, { eventId: 'sale-1' }] }] }
  }]);

  assert.equal(journal.cardGroups.length, 1);
  assert.equal(journal.cardGroups[0].title, 'Монстера · Monstera deliciosa · Borsigiana');
  assert.equal(journal.cardGroups[0].events.length, 2);
  assert.equal(journal.cardGroups[0].quantityLabel, '88 шт.');
  assert.equal(journal.cardGroups[0].batchUrl.includes('/stages?batchId=report%3Aevent-meta-report%3A%3Acard-1'), true);
  assert.equal(journal.groups[0].events[0].id, 'sale-1');
  assert.equal(journal.groups[0].events[0].cardQuantityLabel, '88 шт.');
  assert.ok(journal.groups[0].events[0].cardDaysInStageLabel.endsWith('дн. в стадии'));
});

run('adds observation details in global journal from extra fields', () => {
  const journal = buildJournalPageModel([{
    reportId: 'observation-report',
    cards: [{ ...card, events: [{
      eventId: 'observation-1',
      type: 'hardeningObservation',
      title: 'Наблюдение',
      date: '2026-06-19T11:00:00.000Z',
      extraFields: { readinessForPlanting: 'Готова' }
    }] }],
    raw: { cards: [{ events: [{ eventId: 'observation-1' }] }] }
  }]);

  assert.deepEqual(journal.events[0].details, [
    { label: 'Готовность к высадке', value: 'Готова' }
  ]);
});

run('keeps raw-only cards in the global journal', () => {
  const journal = buildJournalPageModel([{
    reportId: 'raw-only-card-report',
    createdAt: '2026-07-15T09:00:00.000Z',
    cards: [],
    raw: { cards: [{
      cardId: 'raw-card-1',
      code: 'RAW-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      updatedAt: '2026-07-15T09:00:00.000Z',
      events: [{
        eventId: 'raw-only-event',
        type: 'sale',
        createdAt: '2026-07-15T08:00:00.000Z',
        count: 5,
        createdBy: 'Anna Ivanova'
      }]
    }] }
  }], { category: 'sales' });

  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].id, 'raw-only-event');
  assert.equal(journal.events[0].code, 'RAW-1');
  assert.equal(journal.events[0].culture, 'Birch');
  assert.equal(journal.events[0].category, 'sales');
  assert.equal(journal.events[0].quantity, 5);
});

run('uses singular photoPath alias for global journal event photos', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-photo-path-report',
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`,
    cards: [{ ...card, events: [{
      eventId: 'photo-path-event',
      type: 'problem',
      date: '2026-06-19T11:00:00.000Z',
      photoPath: 'photos/problem-path.jpg'
    }] }],
    raw: { cards: [{ events: [{ eventId: 'photo-path-event' }] }] }
  }]);

  assert.equal(journal.events[0].hasPhotos, true);
  assert.deepEqual(journal.events[0].photos, ['/storage/photos/problem-path.jpg']);
});

run('uses raw event photoPath alias for global journal event photos', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-raw-photo-path-report',
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`,
    cards: [{ ...card, events: [{
      eventId: 'raw-photo-path-event',
      type: 'problem',
      date: '2026-06-19T11:00:00.000Z'
    }] }],
    raw: { cards: [{ events: [{
      eventId: 'raw-photo-path-event',
      photoPath: 'photos/raw-problem-path.jpg'
    }] }] }
  }]);

  assert.equal(journal.events[0].hasPhotos, true);
  assert.deepEqual(journal.events[0].photos, ['/storage/photos/raw-problem-path.jpg']);
});

run('uses object photo aliases for global journal event photos', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-object-photo-report',
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`,
    cards: [{ ...card, events: [{
      eventId: 'object-photo-event',
      type: 'problem',
      date: '2026-06-19T11:00:00.000Z',
      photos: [{ photoPath: 'photos/problem-object.jpg' }]
    }] }],
    raw: { cards: [{ events: [{ eventId: 'object-photo-event' }] }] }
  }]);

  assert.equal(journal.events[0].hasPhotos, true);
  assert.deepEqual(journal.events[0].photos, ['/storage/photos/problem-object.jpg']);
});

run('keeps parsed event photos in global journal when raw snapshot photo arrays contain only blank strings', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-blank-raw-photo-array-report',
    getPhotoUrl: (photoPath) => `/storage/${photoPath}`,
    cards: [{ ...card, events: [{
      eventId: 'blank-raw-photo-array-event',
      type: 'problem',
      date: '2026-06-19T11:00:00.000Z',
      photoFiles: ['photos/problem-kept.jpg']
    }] }],
    raw: { cards: [{ events: [{
      eventId: 'blank-raw-photo-array-event',
      photoFiles: ['   ']
    }] }] }
  }]);

  assert.equal(journal.events[0].hasPhotos, true);
  assert.deepEqual(journal.events[0].photos, ['/storage/photos/problem-kept.jpg']);
});

run('keeps raw event details in global journal when parsed snapshot contains only eventId', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-raw-event-details-report',
    cards: [{ ...card, events: [{
      eventId: 'raw-movement-event'
    }] }],
    raw: { cards: [{ events: [{
      eventId: 'raw-movement-event',
      type: 'movement',
      createdAt: '2026-06-19T11:00:00.000Z',
      createdBy: 'Anna Ivanova',
      comment: 'Жёлтый ящик',
      nextLocation: 'Теплица 1'
    }] }] }
  }], { category: 'movement' });

  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].category, 'movement');
  assert.equal(journal.events[0].title, 'Перемещение');
  assert.equal(journal.events[0].date, '2026-06-19T11:00:00.000Z');
  assert.equal(journal.events[0].comment, 'Жёлтый ящик');
  assert.ok(journal.events[0].details.some((item) => item.label === 'Куда' && item.value === 'Теплица 1'));
  assert.ok(journal.events[0].details.some((item) => item.label === 'Комментарий' && item.value === 'Жёлтый ящик'));
});

run('uses documented operation types for categories and chronological groups', () => {
  const events = buildGlobalJournal(reports);
  assert.equal(getEventCategory({ type: 'greenhouseCare' }), 'care');
  assert.equal(getEventCategory({ type: 'plantingCompletion' }), 'completion');
  assert.equal(getEventCategory({ type: 'clonedFromParent' }), 'propagation');
  assert.equal(groupEventsByDate(events).length, 2);
});

run('does not mark ordinary stage changes as important', () => {
  const journal = buildJournalPageModel([{
    reportId: 'stage-change-report',
    cards: [{ ...card, events: [{ eventId: 'stage-1', type: 'stageChange', date: '2026-06-19T10:00:00.000Z', fromStage: 'Закалка', toStage: 'Высадка' }] }],
    raw: { cards: [{ events: [{ eventId: 'stage-1' }] }] }
  }], { quick: 'important' });

  assert.equal(journal.summary.total, 0);
  assert.equal(journal.groups.length, 0);
});

run('keeps clone relation details in the global journal', () => {
  const journal = buildJournalPageModel([{
    reportId: 'clone-journal-report',
    createdAt: '2026-07-15T09:00:00.000Z',
    cards: [{ ...card, events: [{
      eventId: 'clone-event',
      type: 'clonedFromParent',
      date: '2026-07-15T09:00:00.000Z',
      count: 12,
      extraFields: {
        parentCode: 'VK-PARENT',
        childCode: 'VK-CHILD',
        generation: 2,
        propagationMethod: 'Черенкование'
      }
    }] }],
    raw: { cards: [{ events: [{ eventId: 'clone-event' }] }] }
  }], { category: 'propagation' });

  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].category, 'propagation');
  assert.ok(journal.events[0].details.some((item) => item.label === 'Родительская партия' && item.value === 'VK-PARENT'));
  assert.ok(journal.events[0].details.some((item) => item.label === 'Дочерняя партия' && item.value === 'VK-CHILD'));
});

run('matches global journal problem filters by event extraFields problem signals', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-extra-problem-fields-report',
    createdAt: '2026-07-16T10:00:00.000Z',
    cards: [{ ...card, events: [{
      eventId: 'problem-extra-fields-event',
      type: 'movement',
      date: '2026-07-16T09:00:00.000Z',
      extraFields: {
        problemType: 'РљРѕРЅС‚Р°РјРёРЅР°С†РёСЏ',
        riskLevel: 'Р’С‹СЃРѕРєРёР№',
        problemDescription: 'Р—Р°СЂР°Р¶РµРЅРёРµ РјРёРєСЂРѕР±Р°РјРё'
      }
    }] }],
    raw: { cards: [{ events: [{ eventId: 'problem-extra-fields-event' }] }] }
  }], { category: 'problems', quick: 'important' });

  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].id, 'problem-extra-fields-event');
  assert.equal(journal.events[0].category, 'problems');
  assert.equal(journal.events[0].isImportant, true);
  assert.equal(journal.events[0].details.length >= 2, true);
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

run('uses top-level report author for local app user events when report user is missing', () => {
  const events = buildGlobalJournal([{
    reportId: 'author-only-report',
    createdAt: '2026-07-31T09:00:00.000Z',
    author: 'Anna Ivanova',
    cards: [{ ...card, events: [{ eventId: 'local-author-event', type: 'introloss', date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user', count: 3 }] }],
    raw: { cards: [{ events: [{ eventId: 'local-author-event' }] }] }
  }]);
  assert.equal(events[0].createdBy, 'Anna Ivanova');
});

run('uses top-level report author in single-report journal when report user is missing', () => {
  const journal = buildJournalModel({
    reportId: 'author-only-journal',
    createdAt: '2026-07-31T09:00:00.000Z',
    author: 'Anna Ivanova',
    cards: [{ ...card, events: [{ eventId: 'single-journal-local-user', type: 'introloss', date: '2026-07-31T08:00:00.000Z', createdBy: 'local-user', count: 2 }] }]
  });
  assert.equal(journal.reportTitle, 'Anna Ivanova');
  assert.equal(journal.entries[0].createdBy, 'Anna Ivanova');
});

run('uses readable fallback title in single-report journal when report is missing', () => {
  const journal = buildJournalModel(null);
  assert.equal(journal.reportTitle, '\u0416\u0443\u0440\u043d\u0430\u043b');
});

run('matches single-report journal stage and subtab query params case-insensitively and ignores extra spaces', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-query-filters',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      stage: 'теплица',
      events: [
        { eventId: 'single-care', type: 'greenhouseCare', date: '2026-07-31T08:00:00.000Z' },
        { eventId: 'single-sale', type: 'sale', date: '2026-07-31T07:00:00.000Z', count: 2 }
      ]
    }]
  }, { stage: ' ТЕПЛИЦА ', subtab: ' CARE ' });

  assert.equal(journal.selectedStage, 'Теплица');
  assert.equal(journal.selectedSubtab, 'care');
  assert.equal(journal.entries.length, 1);
  assert.equal(journal.entries[0].entryId, 'single-care');
});

run('matches single-report journal stage filters for imported English stage names', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-english-stage',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      stage: 'Greenhouse',
      events: [
        { eventId: 'single-english-care', type: 'greenhouseCare', date: '2026-07-31T08:00:00.000Z' },
        { eventId: 'single-english-sale', type: 'sale', date: '2026-07-31T07:00:00.000Z', count: 2 }
      ]
    }]
  }, { stage: ' ТЕПЛИЦА ', subtab: 'care' });

  assert.equal(journal.selectedStage, 'Теплица');
  assert.equal(journal.selectedSubtab, 'care');
  assert.equal(journal.entries.length, 1);
  assert.equal(journal.entries[0].entryId, 'single-english-care');
  assert.equal(journal.entries[0].stage, 'Теплица');
});

run('uses report employee name instead of technical userId in single-report journal', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-userid-author',
    createdAt: '2026-07-31T09:00:00.000Z',
    user: { userId: 'demo-user-001', displayName: 'Иван Петров' },
    cards: [{
      ...card,
      events: [{ eventId: 'single-userid-event', type: 'movement', date: '2026-07-31T08:00:00.000Z', createdBy: 'demo-user-001' }]
    }]
  });

  assert.equal(journal.entries[0].createdBy, 'Иван Петров');
});

run('uses singular photoPath alias in single-report journal entries', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-photo-path',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      events: [{ eventId: 'single-photo-path-event', type: 'problem', date: '2026-07-31T08:00:00.000Z', photoPath: 'photos/single-photo-path.jpg' }]
    }]
  });

  assert.equal(journal.entries[0].hasPhotos, true);
  assert.deepEqual(journal.entries[0].photos, ['photos/single-photo-path.jpg']);
});

run('uses object photo aliases in single-report journal entries and cards', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-photo-object',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      photos: [{ photoPath: 'photos/card-photo-object.jpg' }],
      events: [{ eventId: 'single-photo-object-event', type: 'problem', date: '2026-07-31T08:00:00.000Z', photos: [{ photoPath: 'photos/single-photo-object.jpg' }] }]
    }]
  });

  assert.equal(journal.entries[0].hasPhotos, true);
  assert.deepEqual(journal.entries[0].photos, ['photos/single-photo-object.jpg']);
  assert.deepEqual(journal.cards[0].photos, ['photos/card-photo-object.jpg']);
  assert.equal(journal.cards[0].photoCount, 2);
});

run('keeps parsed event photos in single-report journal when raw snapshot photo arrays contain only blank strings', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-blank-raw-photo-array',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      events: [{
        eventId: 'single-blank-raw-photo-array-event',
        type: 'problem',
        date: '2026-07-31T08:00:00.000Z',
        photoFiles: ['photos/single-photo-kept.jpg']
      }]
    }],
    raw: { cards: [{
      events: [{
        eventId: 'single-blank-raw-photo-array-event',
        photoFiles: ['   ']
      }]
    }] }
  });

  assert.equal(journal.entries[0].hasPhotos, true);
  assert.deepEqual(journal.entries[0].photos, ['photos/single-photo-kept.jpg']);
});

run('uses singular card photoPath alias in single-report journal cards', () => {
  const journal = buildJournalModel({
    reportId: 'single-card-photo-path',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      photoPath: 'photos/card-photo-path.jpg',
      events: []
    }]
  });

  assert.deepEqual(journal.cards[0].photos, ['photos/card-photo-path.jpg']);
  assert.equal(journal.cards[0].photoCount, 1);
});

run('keeps raw-only cards in single-report journal', () => {
  const journal = buildJournalModel({
    reportId: 'single-raw-only-card',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [],
    raw: { cards: [{
      cardId: 'raw-card-1',
      code: 'RAW-1',
      cultureName: 'Birch',
      stage: 'Теплица',
      updatedAt: '2026-07-31T08:30:00.000Z',
      events: [{ eventId: 'single-raw-only-event', type: 'sale', date: '2026-07-31T08:00:00.000Z', count: 2 }]
    }] }
  });

  assert.equal(journal.cards.length, 1);
  assert.equal(journal.entries.length, 1);
  assert.equal(journal.cards[0].code, 'RAW-1');
  assert.equal(journal.entries[0].entryId, 'single-raw-only-event');
  assert.equal(journal.entries[0].quantity, '2');
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

run('uses normalized card plant aliases in journal events when *Name fields are missing', () => {
  const events = buildGlobalJournal([{
    reportId: 'card-aliases-journal',
    cards: [{
      cardId: 'card-2',
      code: 'TP-ALIASES',
      culture: 'Birch',
      sort: 'Betula',
      variety: 'Pendula',
      stage: 'Теплица',
      events: [{ eventId: 'alias-event', type: 'movement', date: '2026-07-15T09:00:00.000Z' }]
    }],
    raw: { cards: [{ events: [{ eventId: 'alias-event' }] }] }
  }]);

  assert.equal(events[0].culture, 'Birch · Betula · Pendula');
});

run('hides technical missing plant names in single-report journal cards and entries', () => {
  const journal = buildJournalModel({
    reportId: 'single-hidden-plant-name',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      cardId: 'card-1',
      code: 'TP-1',
      cultureName: 'Арония',
      speciesName: 'Мулатка',
      varietyName: 'Отсутствует',
      stage: 'Теплица',
      events: [{ eventId: 'single-move-1', type: 'movement', date: '2026-07-31T08:00:00.000Z' }]
    }]
  });

  assert.equal(journal.cards[0].cultureName, 'Арония');
  assert.equal(journal.cards[0].speciesName, 'Мулатка');
  assert.equal(journal.cards[0].varietyName, '');
  assert.equal(journal.entries[0].cardCulture, 'Арония · Мулатка');
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

run('uses readable fallbacks when journal event dates are missing everywhere', () => {
  const journal = buildJournalPageModel([{
    reportId: 'missing-dates-report',
    createdAt: '',
    cards: [{
      ...card,
      updatedAt: '',
      createdAt: '',
      events: [{ eventId: 'missing-date-event', type: 'greenhouseCare', date: '', createdAt: '', createdBy: 'user-1' }]
    }],
    raw: { cards: [{ events: [{ eventId: 'missing-date-event' }] }] }
  }], { period: 'all' });

  assert.equal(journal.groups[0].label, 'Дата не указана');
  assert.equal(journal.events[0].cardDateLabel, '');
  assert.equal(journal.events[0].timeLabel, '—');
  assert.equal(journal.events[0].cardDaysInStage, 0);
  assert.equal(journal.events[0].cardDaysInStageLabel, '');
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

run('matches journal stage filters case-insensitively and ignores extra spaces', () => {
  const journal = buildJournalPageModel([{
    reportId: 'stage-filter-report',
    cards: [{
      ...card,
      stage: '  теплица  ',
      events: [{ eventId: 'stage-filter-event', type: 'greenhouseCare', date: '2026-07-16T08:04:00.000Z' }]
    }],
    raw: { cards: [{ events: [{ eventId: 'stage-filter-event' }] }] }
  }], { stage: ' ТЕПЛИЦА ' });

  assert.equal(journal.filters.stage, 'Теплица');
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].stage, 'Теплица');
});

run('matches journal stage filters for imported English stage names', () => {
  const journal = buildJournalPageModel([{
    reportId: 'stage-filter-english-report',
    cards: [{
      ...card,
      stage: 'Greenhouse',
      events: [{ eventId: 'stage-filter-english-event', type: 'greenhouseCare', date: '2026-07-16T08:04:00.000Z' }]
    }],
    raw: { cards: [{ events: [{ eventId: 'stage-filter-english-event' }] }] }
  }], { stage: ' ТЕПЛИЦА ' });

  assert.equal(journal.filters.stage, 'Теплица');
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].stage, 'Теплица');
});

run('matches journal category and quick filters case-insensitively and ignores extra spaces', () => {
  const journal = buildJournalPageModel([{
    reportId: 'category-quick-filter-report',
    createdAt: '2026-07-16T10:00:00.000Z',
    cards: [{ ...card, events: [
      { eventId: 'problem-quarantine', type: 'problem', date: '2026-07-16T09:00:00.000Z', problemType: 'Карантин', comment: 'Изолирована партия' },
      { eventId: 'problem-pest', type: 'problem', date: '2026-07-16T08:00:00.000Z', problemType: 'Вредители' },
      { eventId: 'release-quarantine', type: 'quarantineReleased', date: '2026-07-16T07:00:00.000Z' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'problem-quarantine' }, { eventId: 'problem-pest' }, { eventId: 'release-quarantine' }] }] }
  }], { category: ' PROBLEMS ', quick: ' QUARANTINE ' });

  assert.equal(journal.filters.category, 'problems');
  assert.equal(journal.filters.quick, 'quarantine');
  assert.deepEqual(journal.events.map((event) => event.id), ['problem-quarantine', 'release-quarantine']);
});

run('matches journal period filters case-insensitively and ignores extra spaces', () => {
  const now = new Date();
  const today = now.toISOString();
  const oldDate = new Date(now.getTime() - 10 * 86400000).toISOString();
  const journal = buildJournalPageModel([{
    reportId: 'period-filter-report',
    createdAt: '2026-07-16T10:00:00.000Z',
    cards: [{ ...card, events: [
      { eventId: 'period-today', type: 'greenhouseCare', date: today },
      { eventId: 'period-old', type: 'greenhouseCare', date: oldDate }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'period-today' }, { eventId: 'period-old' }] }] }
  }], { period: ' TODAY ' });

  assert.equal(journal.filters.period, 'today');
  assert.deepEqual(journal.events.map((event) => event.id), ['period-today']);
});

run('uses all time as the default journal period when query period is missing', () => {
  const journal = buildJournalPageModel([{
    reportId: 'journal-default-period',
    createdAt: '2026-07-15T09:00:00.000Z',
    user: { userId: 'period-user', displayName: 'Иван Петров' },
    cards: [{ ...card, events: [{ eventId: 'default-period-event', type: 'movement', date: '2026-07-15T08:00:00.000Z', createdBy: 'period-user' }] }],
    raw: { cards: [{ events: [{ eventId: 'default-period-event' }] }] }
  }], {});

  assert.equal(journal.filters.period, 'all');
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].id, 'default-period-event');
});

run('matches journal employee filters case-insensitively and ignores extra spaces', () => {
  const journal = buildJournalPageModel([{
    reportId: 'employee-filter-report',
    createdAt: '2026-07-16T10:00:00.000Z',
    cards: [{ ...card, events: [
      { eventId: 'employee-ivan', type: 'greenhouseCare', date: '2026-07-31T09:00:00.000Z', createdBy: 'Иван Петров' },
      { eventId: 'employee-anna', type: 'greenhouseCare', date: '2026-07-31T08:00:00.000Z', createdBy: 'Анна Иванова' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'employee-ivan' }, { eventId: 'employee-anna' }] }] }
  }], { employee: '  иВаН пЕтРоВ  ' });

  assert.equal(journal.filters.employee, 'Иван Петров');
  assert.deepEqual(journal.events.map((event) => event.id), ['employee-ivan']);
});

run('keeps same-name employees separate in journal employee filters when userIds differ', () => {
  const firstReport = {
    reportId: 'journal-same-name-a',
    createdAt: '2026-07-31T10:00:00.000Z',
    user: { userId: 'same-user-a', displayName: 'Anna Ivanova' },
    cards: [{ ...card, events: [
      { eventId: 'employee-same-a', type: 'greenhouseCare', date: '2026-07-31T09:00:00.000Z', createdBy: 'same-user-a' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'employee-same-a' }] }] }
  };
  const secondReport = {
    reportId: 'journal-same-name-b',
    createdAt: '2026-07-31T11:00:00.000Z',
    user: { userId: 'same-user-b', displayName: 'Anna Ivanova' },
    cards: [{ ...card, events: [
      { eventId: 'employee-same-b', type: 'greenhouseCare', date: '2026-07-31T08:00:00.000Z', createdBy: 'same-user-b' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'employee-same-b' }] }] }
  };

  const journal = buildJournalPageModel([firstReport, secondReport], { employee: 'same-user-a' });

  assert.deepEqual(journal.employeeOptions.map((option) => option.value), ['all', 'same-user-a', 'same-user-b']);
  assert.deepEqual(journal.employeeOptions.slice(1).map((option) => option.label), ['Anna Ivanova (same-user-a)', 'Anna Ivanova (same-user-b)']);
  assert.equal(journal.filters.employee, 'same-user-a');
  assert.deepEqual(journal.events.map((event) => event.id), ['employee-same-a']);
});

run('skips unknown employee placeholder in journal employee filters', () => {
  const journal = buildJournalPageModel([{
    reportId: 'unknown-employee-filter-report',
    createdAt: '2026-07-31T10:00:00.000Z',
    cards: [{ ...card, events: [
      { eventId: 'employee-known', type: 'greenhouseCare', date: '2026-07-31T09:00:00.000Z', createdBy: 'Anna Ivanova' },
      { eventId: 'employee-unknown', type: 'greenhouseCare', date: '2026-07-31T08:00:00.000Z', createdBy: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'employee-known' }, { eventId: 'employee-unknown' }] }] }
  }]);

  assert.deepEqual(journal.employeeOptions.map((option) => option.value), ['all', 'Anna Ivanova']);
  assert.deepEqual(journal.employeeOptions.map((option) => option.label), ['\u0412\u0441\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438', 'Anna Ivanova']);
});

run('filters quarantine events with the dedicated journal preset', () => {
  const events = buildGlobalJournal([{
    reportId: 'quarantine-report',
    createdAt: '2026-07-16T10:00:00.000Z',
    cards: [{ ...card, events: [
      { eventId: 'problem-quarantine', type: 'problem', date: '2026-07-16T09:00:00.000Z', problemType: 'Карантин', comment: 'Изолирована партия' },
      { eventId: 'problem-pest', type: 'problem', date: '2026-07-16T08:00:00.000Z', problemType: 'Вредители' },
      { eventId: 'release-quarantine', type: 'quarantineReleased', date: '2026-07-16T07:00:00.000Z' }
    ] }],
    raw: { cards: [{ events: [{ eventId: 'problem-quarantine' }, { eventId: 'problem-pest' }, { eventId: 'release-quarantine' }] }] }
  }]);
  const filtered = filterJournalEvents(events, { period: 'all', employee: 'all', category: 'problems', stage: 'all', query: '', quick: 'quarantine' });

  assert.deepEqual(filtered.map((event) => event.id), ['problem-quarantine', 'release-quarantine']);
});

run('matches single-report journal problems subtab by event extraFields problem signals', () => {
  const journal = buildJournalModel({
    reportId: 'single-report-extra-problem-fields',
    createdAt: '2026-07-31T09:00:00.000Z',
    cards: [{
      ...card,
      stage: 'РўРµРїР»РёС†Р°',
      events: [{
        eventId: 'single-problem-extra-fields-event',
        type: 'movement',
        date: '2026-07-31T08:00:00.000Z',
        extraFields: {
          problemType: 'РљРѕРЅС‚Р°РјРёРЅР°С†РёСЏ',
          riskLevel: 'Р’С‹СЃРѕРєРёР№',
          problemDescription: 'Р—Р°СЂР°Р¶РµРЅРёРµ РјРёРєСЂРѕР±Р°РјРё'
        }
      }]
    }]
  }, { subtab: 'problems' });

  assert.equal(journal.entries.length, 1);
  assert.equal(journal.entries[0].entryId, 'single-problem-extra-fields-event');
  assert.equal(journal.entries[0].subtype, 'problems');
  assert.equal(journal.entries[0].isProblem, true);
  assert.equal(journal.entries[0].problemType, 'РљРѕРЅС‚Р°РјРёРЅР°С†РёСЏ');
  assert.equal(journal.entries[0].riskLevel, 'Р’С‹СЃРѕРєРёР№');
});

if (process.exitCode) process.exit(process.exitCode);





run('shows isolation and recovery metadata in the global journal', () => {
  const journal = buildJournalPageModel([{ reportId: 'isolation-journal-report', createdAt: '2026-07-16T09:00:00.000Z', cards: [{ ...card, events: [{ eventId: 'isolation-event', type: 'problemIsolation', date: '2026-07-16T09:00:00.000Z', count: 3, extraFields: { parentCode: 'VK-PARENT', childCode: 'VK-ISO', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 3 } }, { eventId: 'recovery-event', type: 'problemRecovery', date: '2026-07-17T09:00:00.000Z', count: 3, currentQuantity: 10, extraFields: { healthStatus: 'healthy', isolationStatus: 'released', activeProblemQuantity: 0 } }] }], raw: { cards: [{ events: [{ eventId: 'isolation-event' }, { eventId: 'recovery-event' }] }] } }], { category: 'problems' });
  assert.equal(journal.events.length, 2);
  assert.ok(journal.events.some((event) => event.title.includes('Изол')));
  assert.ok(journal.events.some((event) => event.title.includes('Проблема')));
  const isolationEvent = journal.events.find((event) => event.id === 'isolation-event');
  assert.ok(isolationEvent.details.some((item) => item.label === 'Источник проблемы' && item.value === 'problem-origin-1'));
});
