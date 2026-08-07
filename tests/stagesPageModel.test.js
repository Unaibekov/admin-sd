const assert = require('assert/strict');
const { buildBatchCatalog, buildStagesPageModel, formatDate } = require('../src/stagesPageModel');

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

run('keeps parsed-only cards when raw snapshot cards array is shorter', () => {
  const report = buildReport({ reportId: 'report-parsed-extra-card', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'event-a' });
  report.raw.cards = [report.raw.cards[0]];
  report.cards = [
    report.cards[0],
    {
      cardId: 'parsed-only-card',
      code: 'VK-PARSED-ONLY',
      cultureName: 'Birch',
      speciesName: 'Betula',
      varietyName: 'Pendula',
      stage: 'РўРµРїР»РёС†Р°',
      batchStatus: 'active',
      quantity: 5,
      currentQuantity: 5,
      createdAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T09:00:00.000Z',
      events: []
    }
  ];

  const cards = buildBatchCatalog([report]);

  assert.equal(cards.length, 2);
  assert.ok(cards.some((card) => card.cardId === 'parsed-only-card'));
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

run('selects a batch by batchId case-insensitively', () => {
  const reports = [buildReport({ reportId: 'report-batch-case', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-batch-case' })];
  const [card] = buildBatchCatalog(reports);
  const model = buildStagesPageModel(reports, { batchId: card.batchKey.toUpperCase() });

  assert.equal(model.selectedCard.batchKey, card.batchKey);
  assert.equal(model.selectedBatchKey, card.batchKey);
});

run('uses journal as the default batch details tab', () => {
  const reports = [buildReport({ reportId: 'report-default-tab', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-a' })];

  assert.equal(buildStagesPageModel(reports, {}).selectedTab, 'journal');
  assert.equal(buildStagesPageModel(reports, { tab: 'calendar' }).selectedTab, 'journal');
  assert.equal(buildStagesPageModel(reports, { tab: 'passport' }).selectedTab, 'passport');
  assert.equal(buildStagesPageModel(reports, { tab: ' PASSPORT ' }).selectedTab, 'passport');
  assert.equal(buildStagesPageModel(reports, { tab: ' JOURNAL ' }).selectedTab, 'journal');
});

run('matches stage filters case-insensitively and ignores extra spaces', () => {
  const report = buildReport({ reportId: 'report-stage-filter', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-stage' });
  report.raw.cards[0].stage = '  введение в культуру  ';
  report.cards[0].stage = '  введение в культуру  ';

  const model = buildStagesPageModel([report], { stage: ' ВВЕДЕНИЕ В КУЛЬТУРУ ' });

  assert.equal(model.selectedStage, 'Введение в культуру');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].stage, 'Введение в культуру');
  assert.equal(model.stages.find((item) => item.key === 'Введение в культуру').count, 1);
});

run('maps imported English stage names to the documented lifecycle stage filters', () => {
  const report = buildReport({ reportId: 'report-stage-aliases', deviceId: 'device-a', updatedAt: '2026-06-10T09:00:00.000Z', quantity: 10, eventId: 'event-stage-alias' });
  report.raw.cards[0].stage = 'Greenhouse';
  report.cards[0].stage = 'Greenhouse';

  const model = buildStagesPageModel([report], { stage: 'Теплица' });

  assert.equal(model.selectedStage, 'Теплица');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].stage, 'Теплица');
  assert.equal(model.stages.find((item) => item.key === 'Теплица').count, 1);
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

run('treats batch journal events with only extraFields problem signals as problems', () => {
  const report = buildReport({ reportId: 'report-extra-problem-event', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'problem-extra-fields-a' });
  report.raw.cards[0].events = [
    {
      eventId: 'problem-extra-fields-a',
      type: 'movement',
      createdAt: '2026-07-15T09:00:00.000Z',
      extraFields: {
        affectedQuantity: 100,
        problemType: 'РљРѕРЅС‚Р°РјРёРЅР°С†РёСЏ',
        riskLevel: 'РќРёР·РєРёР№',
        problemDescription: 'Р—Р°СЂР°Р¶РµРЅРёРµ РјРёРєСЂРѕР±Р°РјРё'
      }
    }
  ];

  const model = buildStagesPageModel([report], {});

  assert.equal(model.cards[0].events[0].category, 'problems');
  assert.equal(model.cards[0].events[0].details.length, 4);
  assert.deepEqual(model.cards[0].events[0].details.map((item) => item.value), [
    '100 шт.',
    'РљРѕРЅС‚Р°РјРёРЅР°С†РёСЏ',
    'РќРёР·РєРёР№',
    'Р—Р°СЂР°Р¶РµРЅРёРµ РјРёРєСЂРѕР±Р°РјРё'
  ]);
});

run('uses report employee name instead of technical userId in batch journal', () => {
  const report = buildReport({ reportId: 'report-event-user-id', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'user-id-event' });
  report.user = { userId: 'demo-user-001', displayName: 'Иван Петров' };
  report.raw.cards[0].events = [
    {
      eventId: 'user-id-event',
      type: 'comment',
      title: 'Проверка',
      createdAt: '2026-07-15T09:00:00.000Z',
      createdBy: 'demo-user-001'
    }
  ];

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].createdBy, 'Иван Петров');
});

run('keeps parsed event fields when raw snapshot event contains only eventId', () => {
  const report = buildReport({ reportId: 'report-raw-event-shadow', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'shadow-event' });
  report.raw.cards[0].events = [{ eventId: 'shadow-event' }];
  report.cards[0].events = [{ eventId: 'shadow-event', type: 'comment', title: 'Проверка', createdAt: '2026-07-15T09:00:00.000Z', count: 4 }];

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].type, 'comment');
  assert.equal(model.cards[0].events[0].title, 'Проверка');
  assert.equal(model.cards[0].events[0].createdAt, '2026-07-15T09:00:00.000Z');
  assert.equal(model.cards[0].events[0].count, 4);
});

run('keeps parsed event details when separate raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-raw-event-blank-separated', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'shadow-blank-separated' });
  report.raw = {
    cards: [{
      cardId: '1718000000000',
      code: 'VK-20260610-120000',
      stage: 'Р’РІРµРґРµРЅРёРµ РІ РєСѓР»СЊС‚СѓСЂСѓ',
      batchStatus: 'active',
      quantity: 10,
      currentQuantity: 10,
      createdAt: '2026-06-10T08:00:00.000Z',
      updatedAt: '2026-07-15T09:00:00.000Z',
      events: [{
        eventId: 'shadow-blank-separated',
        type: 'movement',
        title: 'РџРµСЂРµРјРµС‰РµРЅРёРµ',
        createdAt: '2026-07-15T09:00:00.000Z',
        comment: '   ',
        nextLocation: '   '
      }]
    }]
  };
  report.cards = [{
    cardId: '1718000000000',
    code: 'VK-20260610-120000',
    cultureName: 'РўРµСЃС‚РѕРІР°СЏ РєСѓР»СЊС‚СѓСЂР°',
    speciesName: 'РўРµСЃС‚РѕРІС‹Р№ РІРёРґ',
    varietyName: 'РўРµСЃС‚РѕРІС‹Р№ СЃРѕСЂС‚',
    stage: 'Р’РІРµРґРµРЅРёРµ РІ РєСѓР»СЊС‚СѓСЂСѓ',
    batchStatus: 'active',
    quantity: 10,
    currentQuantity: 10,
    createdAt: '2026-06-10T08:00:00.000Z',
    updatedAt: '2026-07-15T09:00:00.000Z',
    events: [{
      eventId: 'shadow-blank-separated',
      type: 'movement',
      title: 'РџРµСЂРµРјРµС‰РµРЅРёРµ',
      createdAt: '2026-07-15T09:00:00.000Z',
      comment: 'Перемещено на новый стеллаж',
      nextLocation: 'Теплица 2 · Стеллаж A'
    }]
  }];

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].comment, 'Перемещено на новый стеллаж');
  assert.deepEqual(model.cards[0].events[0].details, [
    { label: 'Куда', value: 'Теплица 2 · Стеллаж A' },
    { label: 'Комментарий', value: 'Перемещено на новый стеллаж' }
  ]);
});

run('keeps parsed event details when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-raw-event-blank-shadow', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'shadow-blank-event' });
  report.raw.cards[0].events = [
    {
      eventId: 'shadow-blank-event',
      type: 'movement',
      title: 'РџРµСЂРµРјРµС‰РµРЅРёРµ',
      createdAt: '2026-07-15T09:00:00.000Z',
      comment: '   ',
      nextLocation: '   '
    }
  ];
  report.cards[0].events = [
    {
      eventId: 'shadow-blank-event',
      type: 'movement',
      title: 'РџРµСЂРµРјРµС‰РµРЅРёРµ',
      createdAt: '2026-07-15T09:00:00.000Z',
      comment: 'Перемещено на новый стеллаж',
      nextLocation: 'Теплица 2 · Стеллаж A'
    }
  ];

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].comment, 'Перемещено на новый стеллаж');
  assert.deepEqual(model.cards[0].events[0].details, [
    { label: 'Куда', value: 'Теплица 2 · Стеллаж A' },
    { label: 'Комментарий', value: 'Перемещено на новый стеллаж' }
  ]);
});

run('keeps parsed event extra fields when raw snapshot extraFields contain only blank strings', () => {
  const report = buildReport({ reportId: 'report-raw-event-extra-blank-shadow', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'shadow-blank-extra-event' });
  report.raw.cards[0] = {
    ...report.raw.cards[0],
    events: [{
      eventId: 'shadow-blank-extra-event',
      type: 'movement',
      title: 'Перемещение',
      createdAt: '2026-07-15T09:00:00.000Z',
      extraFields: {
        nextLocation: '   '
      }
    }]
  };
  report.cards[0] = {
    ...report.cards[0],
    events: [{
      eventId: 'shadow-blank-extra-event',
      type: 'movement',
      title: 'Перемещение',
      createdAt: '2026-07-15T09:00:00.000Z',
      extraFields: {
        nextLocation: 'Теплица 2 · Стеллаж A'
      }
    }]
  };

  const model = buildStagesPageModel([report], {});
  assert.deepEqual(model.cards[0].events[0].details, [
    { label: 'Куда', value: 'Теплица 2 · Стеллаж A' }
  ]);
});

run('uses singular photoPath alias in batch journal events', () => {
  const report = buildReport({ reportId: 'report-event-photo-path', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'photo-path-event' });
  report.raw.cards[0].events = [
    {
      eventId: 'photo-path-event',
      type: 'photo',
      title: 'Р¤РѕС‚Рѕ',
      createdAt: '2026-07-15T09:00:00.000Z',
      photoPath: 'photos/batch-photo-path.jpg'
    }
  ];

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].category, 'photo');
  assert.deepEqual(model.cards[0].events[0].photos, ['photos/batch-photo-path.jpg']);
});

run('keeps parsed batch journal event photos when raw snapshot photo arrays contain only blank strings', () => {
  const report = buildReport({ reportId: 'report-event-photo-blank-raw', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'photo-blank-raw-event' });
  report.cards[0] = {
    ...report.cards[0],
    events: [
      {
        eventId: 'photo-blank-raw-event',
        type: 'photo',
        title: 'Фото',
        createdAt: '2026-07-15T09:00:00.000Z',
        photoFiles: ['photos/batch-photo-kept.jpg']
      }
    ]
  };
  report.raw.cards[0] = {
    ...report.raw.cards[0],
    events: [
      {
        eventId: 'photo-blank-raw-event',
        photoFiles: ['   ']
      }
    ]
  };

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards[0].events[0].category, 'photo');
  assert.deepEqual(model.cards[0].events[0].photos, ['photos/batch-photo-kept.jpg']);
});

run('keeps parsed card plant names and quantities when raw snapshot is minimal', () => {
  const report = buildReport({ reportId: 'report-raw-card-shadow', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'card-shadow-event' });
  report.raw.cards[0] = {
    cardId: 'card-shadow-1',
    code: 'VK-RAW-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'active',
    updatedAt: '2026-07-15T09:00:00.000Z',
    createdAt: '2026-07-15T08:00:00.000Z',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    cultureName: 'Birch',
    speciesName: 'Betula',
    varietyName: 'Pendula',
    quantity: 12,
    currentQuantity: 9
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.culture, 'Birch');
  assert.equal(card.species, 'Betula');
  assert.equal(card.variety, 'Pendula');
  assert.equal(card.currentQuantity, 9);
  assert.equal(card.initialQuantity, 12);
  assert.equal(card.title.includes('Birch'), true);
  assert.equal(card.title.includes('Betula'), true);
  assert.equal(card.title.includes('Pendula'), true);
});

run('uses normalized plant aliases in batch titles when *Name fields are missing', () => {
  const report = buildReport({ reportId: 'report-card-aliases', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'alias-card-event' });
  report.raw.cards[0] = {
    cardId: 'card-alias-1',
    code: 'VK-ALIAS-1',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'active',
    updatedAt: '2026-07-15T09:00:00.000Z',
    createdAt: '2026-07-15T08:00:00.000Z',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    culture: 'Birch',
    sort: 'Betula',
    variety: 'Pendula'
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.culture, 'Birch');
  assert.equal(card.species, 'Betula');
  assert.equal(card.variety, 'Pendula');
  assert.equal(card.title.includes('Birch'), true);
  assert.equal(card.title.includes('Betula'), true);
  assert.equal(card.title.includes('Pendula'), true);
  assert.equal(card.searchText.includes('betula'), true);
});

run('keeps parsed card location when raw snapshot is minimal', () => {
  const report = buildReport({ reportId: 'report-raw-card-location', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'card-location-event' });
  report.raw.cards[0] = {
    cardId: 'card-location-1',
    code: 'VK-RAW-LOCATION',
    stage: 'РўРµРїР»РёС†Р°',
    batchStatus: 'active',
    updatedAt: '2026-07-15T09:00:00.000Z',
    createdAt: '2026-07-15T08:00:00.000Z',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    locationDescription: 'Greenhouse 3 / Rack B'
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.location, 'Greenhouse 3 / Rack B');
  assert.equal(card.searchText.includes('greenhouse 3 / rack b'), true);
});

run('keeps parsed card location and quantities when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-raw-card-blank-location-qty', deviceId: 'device-a', updatedAt: '2026-08-01T12:00:00.000Z', quantity: 10, eventId: 'card-blank-location-qty-event' });
  report.raw.cards[0] = {
    cardId: 'card-blank-location-qty-1',
    code: 'VK-RAW-BLANK-LOCATION-QTY',
    stage: 'Теплица',
    batchStatus: 'active',
    locationDescription: '   ',
    quantity: '   ',
    currentQuantity: '   ',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    locationDescription: 'Greenhouse 7 / Rack C',
    quantity: 12,
    currentQuantity: 9
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.location, 'Greenhouse 7 / Rack C');
  assert.equal(card.initialQuantity, 12);
  assert.equal(card.currentQuantity, 9);
  assert.equal(card.totalQuantityLabel, '9 из 12 шт.');
  assert.equal(card.searchText.includes('greenhouse 7 / rack c'), true);
});

run('keeps parsed card status and timestamps when raw snapshot is minimal', () => {
  const report = buildReport({ reportId: 'report-raw-card-time-status', deviceId: 'device-a', updatedAt: '2026-08-01T12:00:00.000Z', quantity: 10, eventId: 'card-time-status-event' });
  report.raw.cards[0] = {
    cardId: 'card-time-status-1',
    code: 'VK-RAW-TIME-STATUS',
    stage: 'РўРµРїР»РёС†Р°',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    batchStatus: 'active',
    createdAt: '2026-07-20T09:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z'
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.status, 'active');
  assert.equal(card.statusLabel.includes('отклон'), true);
  assert.equal(card.createdAt, '2026-07-20T09:00:00.000Z');
  assert.equal(card.updatedAt, '2026-07-31T08:00:00.000Z');
  assert.equal(card.daysInStage > 2, true);
});

run('keeps parsed stage and status when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-raw-card-blank-stage-status', deviceId: 'device-a', updatedAt: '2026-08-01T12:00:00.000Z', quantity: 10, eventId: 'card-blank-stage-status-event' });
  report.raw.cards[0] = {
    cardId: 'card-blank-stage-status-1',
    code: 'VK-RAW-BLANK-STAGE-STATUS',
    stage: '   ',
    batchStatus: '   ',
    events: []
  };
  report.cards[0] = {
    ...report.raw.cards[0],
    stage: 'Теплица',
    batchStatus: 'active',
    createdAt: '2026-07-20T09:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z'
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.stage, 'Теплица');
  assert.equal(card.status, 'active');
  assert.equal(card.statusLabel.includes('отклон'), true);
  assert.equal(card.searchText.includes('теплица'), true);
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

run('keeps parsed qr and clone metadata when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-clone-blank-shadow', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'clone-blank-shadow-event' });
  Object.assign(report.raw.cards[0], {
    stage: 'Теплица',
    qrStatus: '   ',
    originType: '   ',
    parentCode: '   ',
    propagatedAt: '   ',
    propagationMethod: '   ',
    stageChangedAt: '   ',
    events: []
  });
  report.cards[0] = {
    ...report.raw.cards[0],
    qrStatus: 'printed',
    originType: 'cloned',
    parentCode: 'VK-PARENT',
    propagatedAt: '2026-07-15T09:00:00.000Z',
    propagationMethod: 'Черенкование',
    stageChangedAt: '2026-07-10T09:00:00.000Z'
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.qrStatus, 'printed');
  assert.equal(card.qrStatusLabel.includes('печат'), true);
  assert.equal(card.originType, 'cloned');
  assert.equal(card.parentCode, 'VK-PARENT');
  assert.equal(card.propagatedAt, '2026-07-15T09:00:00.000Z');
  assert.equal(card.propagationMethod, 'Черенкование');
  assert.equal(card.stageChangedAt, '2026-07-10T09:00:00.000Z');
  assert.equal(card.searchText.includes('vk-parent'), true);
});

run('keeps parsed summary quantities when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-blank-summary-quantities', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'blank-summary-quantities-event' });
  Object.assign(report.raw.cards[0], {
    stage: 'Теплица',
    batchStatus: 'active',
    activeProblemQuantity: '   ',
    healthyQuantity: '   ',
    sourceQuantity: '   ',
    propagationQuantity: '   ',
    events: []
  });
  report.cards[0] = {
    ...report.raw.cards[0],
    activeProblemQuantity: 3,
    healthyQuantity: 9,
    sourceQuantity: 4,
    propagationQuantity: 12
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.activeProblemQuantity, 3);
  assert.equal(card.healthyQuantity, 9);
  assert.equal(card.sourceQuantity, 4);
  assert.equal(card.propagationQuantity, 12);
});

run('keeps parsed contamination, risk and generation when raw snapshot contains only blank strings', () => {
  const report = buildReport({ reportId: 'report-blank-risk-generation', deviceId: 'device-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'blank-risk-generation-event' });
  Object.assign(report.raw.cards[0], {
    stage: 'Теплица',
    batchStatus: 'problem',
    sterilityStatus: '   ',
    problemType: '   ',
    riskLevel: '   ',
    generation: '   ',
    events: []
  });
  report.cards[0] = {
    ...report.raw.cards[0],
    sterilityStatus: 'contaminated',
    problemType: 'Disease',
    riskLevel: 'High',
    generation: 2
  };

  const [card] = buildBatchCatalog([report]);

  assert.equal(card.sterilityStatus, 'contaminated');
  assert.equal(card.problemType, 'Disease');
  assert.equal(card.riskLevel, 'High');
  assert.equal(card.generation, 2);
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

run('matches stages search by employee name', () => {
  const report = buildReport({ reportId: 'report-search-employee', deviceId: 'device-search', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'employee-search' });
  report.user = { userId: 'anna', displayName: 'Anna Ivanova' };

  const model = buildStagesPageModel([report], { q: ' anna ' });
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeName, 'Anna Ivanova');
});

run('matches employee filters case-insensitively and ignores extra spaces', () => {
  const first = buildReport({ reportId: 'report-first-case', deviceId: 'device-first', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'employee-first-case' });
  first.user = { userId: 'anna', displayName: 'Анна Иванова' };
  const second = buildReport({ reportId: 'report-second-case', deviceId: 'device-second', updatedAt: '2026-07-15T10:00:00.000Z', quantity: 8, eventId: 'employee-second-case' });
  second.user = { userId: 'petr', displayName: 'Пётр Петров' };

  const model = buildStagesPageModel([first, second], { employee: '  ANNA  ' });

  assert.equal(model.selectedEmployee, 'anna');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeKey, 'anna');
});

run('falls back to the first employee when stages employee query is invalid', () => {
  const first = buildReport({ reportId: 'report-first-invalid', deviceId: 'device-first-invalid', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'employee-first-invalid' });
  first.user = { userId: 'anna', displayName: 'Anna Ivanova' };
  const second = buildReport({ reportId: 'report-second-invalid', deviceId: 'device-second-invalid', updatedAt: '2026-07-15T10:00:00.000Z', quantity: 8, eventId: 'employee-second-invalid' });
  second.user = { userId: 'petr', displayName: 'Petr Petrov' };

  const model = buildStagesPageModel([first, second], { employee: 'missing employee' });

  assert.equal(model.selectedEmployee, 'anna');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeKey, 'anna');
});

run('disambiguates same-name employee labels in stage filters when userIds differ', () => {
  const first = buildReport({ reportId: 'report-same-name-a', deviceId: 'device-same-name-a', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 12, eventId: 'employee-same-name-a' });
  first.user = { userId: 'anna-user-a', displayName: 'Anna Ivanova' };
  const second = buildReport({ reportId: 'report-same-name-b', deviceId: 'device-same-name-b', updatedAt: '2026-07-15T10:00:00.000Z', quantity: 8, eventId: 'employee-same-name-b' });
  second.user = { userId: 'anna-user-b', displayName: 'Anna Ivanova' };

  const model = buildStagesPageModel([first, second], { employee: 'anna-user-a' });

  assert.deepEqual(model.employees.slice(1).map((employee) => employee.key), ['anna-user-a', 'anna-user-b']);
  assert.deepEqual(model.employees.slice(1).map((employee) => employee.label), ['Anna Ivanova (anna-user-a)', 'Anna Ivanova (anna-user-b)']);
  assert.equal(model.selectedEmployee, 'anna-user-a');
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeKey, 'anna-user-a');
});

run('uses a readable all-employees label in stage filters', () => {
  const report = buildReport({ reportId: 'report-all-employees-label', deviceId: 'device-all-employees-label', updatedAt: '2026-07-15T09:00:00.000Z', quantity: 10, eventId: 'employee-all-label' });
  report.user = { userId: 'anna', displayName: 'Anna Ivanova' };

  const model = buildStagesPageModel([report], {});

  assert.equal(model.employees[0].key, 'all');
  assert.equal(model.employees[0].label, 'Все сотрудники');
});

run('falls back to employee full name when display name contains only spaces', () => {
  const report = buildReport({ reportId: 'report-blank-display-name', deviceId: 'device-blank', updatedAt: '2026-07-15T11:00:00.000Z', quantity: 7, eventId: 'employee-blank' });
  report.user = { userId: '', displayName: '   ', firstName: 'Anna', lastName: 'Ivanova' };

  const model = buildStagesPageModel([report], {});

  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeName, 'Anna Ivanova');
  assert.equal(model.cards[0].employeeKey, 'anna ivanova');
});

run('falls back to top-level author when report user is missing', () => {
  const report = buildReport({ reportId: 'report-top-level-author', deviceId: 'device-author', updatedAt: '2026-07-15T12:00:00.000Z', quantity: 6, eventId: 'author-fallback' });
  delete report.user;
  report.author = 'Anna Ivanova';

  const model = buildStagesPageModel([report], {});

  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeName, 'Anna Ivanova');
  assert.equal(model.cards[0].employeeKey, 'anna ivanova');
}
);

run('uses readable fallback employee name when report metadata is missing', () => {
  const report = buildReport({ reportId: 'report-unknown-employee', deviceId: 'device-unknown', updatedAt: '2026-07-15T12:00:00.000Z', quantity: 6, eventId: 'unknown-employee' });
  delete report.user;
  report.author = '';
  report.userName = '';

  const model = buildStagesPageModel([report], {});
  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeName, 'Неизвестно');
});

run('includes unknown employee cards in employee filters', () => {
  const report = buildReport({ reportId: 'report-unknown-employee-filter', deviceId: 'device-unknown-filter', updatedAt: '2026-07-15T12:30:00.000Z', quantity: 6, eventId: 'unknown-employee-filter' });
  delete report.user;
  report.author = '';
  report.userName = '';

  const model = buildStagesPageModel([report], { employee: 'неизвестно' });

  assert.equal(model.cards.length, 1);
  assert.equal(model.cards[0].employeeKey, 'неизвестно');
  assert.equal(model.selectedEmployee, 'неизвестно');
  assert.equal(model.employees.some((employee) => employee.key === 'неизвестно' && employee.label === 'Неизвестно'), true);
});

run('uses a readable dash when stages date is missing', () => {
  assert.equal(formatDate(''), '—');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}



run('keeps isolation metadata and batch relations in batch model', () => {
  const parent = buildReport({ reportId: 'report-parent-isolation', deviceId: 'device-a', updatedAt: '2026-07-16T09:00:00.000Z', quantity: 10, eventId: 'problem-isolation-parent-event' });
  Object.assign(parent.raw.cards[0], { cardId: 'parent-card-1', code: 'VK-PARENT', stage: 'Теплица', currentQuantity: 7, batchStatus: 'problem', events: [{ eventId: 'problem-isolation-parent-event', type: 'problemIsolation', createdAt: '2026-07-16T09:00:00.000Z', count: 3, currentQuantity: 7, childCardId: 'isolated-card-1', childCode: 'VK-ISO', sourceProblemEventId: 'problem-origin-1', activeProblemQuantity: 3, unisolatedProblemQuantity: 0, healthStatus: 'infected', isolationStatus: 'isolated' }] });
  parent.cards[0] = { ...parent.raw.cards[0] };
  const child = buildReport({ reportId: 'report-child-isolation', deviceId: 'device-a', updatedAt: '2026-07-16T09:05:00.000Z', quantity: 3, eventId: 'isolated-from-parent-event' });
  Object.assign(child.raw.cards[0], { cardId: 'isolated-card-1', code: 'VK-ISO', stage: 'Теплица', currentQuantity: 3, batchStatus: 'quarantine', originType: 'problemIsolation', parentCardId: 'parent-card-1', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated', activeProblemQuantity: 3, unisolatedProblemQuantity: 0, events: [{ eventId: 'isolated-from-parent-event', type: 'isolatedFromParent', createdAt: '2026-07-16T09:05:00.000Z', count: 3, parentCardId: 'parent-card-1', parentCode: 'VK-PARENT', sourceProblemEventId: 'problem-origin-1', healthStatus: 'infected', isolationStatus: 'isolated' }] });
  child.cards[0] = { ...child.raw.cards[0] };
  const model = buildStagesPageModel([parent, child], { batchId: 'device-a::isolated-card-1', tab: 'passport' });
  const isolatedCard = model.selectedCard;
  const parentCard = model.cards.find((card) => card.code === 'VK-PARENT');
  assert.equal(isolatedCard.originType, 'problemIsolation');
  assert.equal(isolatedCard.parentCode, 'VK-PARENT');
  assert.equal(isolatedCard.sourceProblemEventId, 'problem-origin-1');
  assert.equal(isolatedCard.healthStatus, 'infected');
  assert.equal(isolatedCard.isolationStatus, 'isolated');
  assert.equal(isolatedCard.parentBatch.code, 'VK-PARENT');
  assert.equal(parentCard.childBatches[0].code, 'VK-ISO');
  assert.equal(isolatedCard.events[0].sourceProblemEventId, 'problem-origin-1');
  assert.equal(isolatedCard.originLabel, 'Изолированная партия');
  assert.equal(isolatedCard.healthStatusLabel, 'Проблема активна');
  assert.equal(isolatedCard.isolationStatusLabel, 'Изолирована');
});
