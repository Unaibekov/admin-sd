const JOURNAL_STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const JOURNAL_STAGE_LABELS = {
  all: 'Все стадии',
  important: 'Важное',
  'Введение в культуру': 'Введение в культуру',
  'Клонирование': 'Клонирование',
  'Адаптация': 'Адаптация',
  'Теплица': 'Теплица',
  'Закалка': 'Закалка',
  'Высадка': 'Высадка'
};

const JOURNAL_STAGE_TAB_ORDER = ['all', 'important', ...JOURNAL_STAGE_ORDER];

const JOURNAL_SUBTAB_ORDER = [
  'all',
  'problems',
  'movement',
  'losses',
  'sales',
  'rooting',
  'propagation',
  'observation',
  'care',
  'transplant',
  'planting',
  'completion'
];

const JOURNAL_STAGE_TAB_LABELS = {
  all: 'Все',
  important: 'Важное',
  'Введение в культуру': 'Введение в культуру',
  'Клонирование': 'Клонирование',
  'Адаптация': 'Адаптация',
  'Теплица': 'Теплица',
  'Закалка': 'Закалка',
  'Высадка': 'Высадка'
};

const JOURNAL_SUBTAB_LABELS = {
  all: 'Все',
  problems: 'Проблемы',
  movement: 'Перемещения',
  losses: 'Потери',
  sales: 'Продажи',
  rooting: 'Укоренение',
  propagation: 'Размножение',
  observation: 'Наблюдения',
  care: 'Уход',
  transplant: 'Пересадка',
  planting: 'Высадка',
  completion: 'Завершение'
};

const JOURNAL_TAB_ORDER = JOURNAL_SUBTAB_ORDER;
const JOURNAL_TAB_LABELS = JOURNAL_SUBTAB_LABELS;

const JOURNAL_EVENT_CATEGORY_LABELS = {
  all: 'Все',
  observation: 'Наблюдения',
  care: 'Уход',
  problems: 'Проблемы',
  movement: 'Перемещения',
  losses: 'Потери',
  sales: 'Продажи',
  photo: 'Фото'
};

function buildJournalPageModel(reports = [], query = {}) {
  const search = String(query.q || '').trim();
  const stage = resolveJournalStage(query.stage);
  const tab = resolveJournalTab(query.tab);
  const cards = buildJournalCards(Array.isArray(reports) ? reports : [], search, stage, tab);
  const visibleCards = cards.filter((card) => matchesJournalCard(card, search, stage, tab));

  return {
    cards,
    search,
    stage,
    tab,
    stageTabs: buildStageTabs(cards, stage),
    subtabTabs: buildSubtabTabs(cards, stage, tab),
    employeeTabs: buildEmployeeTabs(cards),
    totalCards: cards.length,
    visibleCardsCount: visibleCards.length,
    selectedCardId: '',
    selectedCard: null,
    hasCards: cards.length > 0,
    hasVisibleCards: visibleCards.length > 0,
    reportCount: new Set(cards.map((card) => card.reportId)).size
  };
}

function buildJournalCards(reports, search, stage, tab) {
  const sortedCards = reports
    .flatMap((report) => {
      const cards = Array.isArray(report.cards) ? report.cards : [];
      const employee = resolveReportEmployee(report);

      return cards.map((card, index) => {
        const events = normalizeJournalEvents(report, card);
        const lastEvent = events[0] || null;
        const title = formatJournalCardTitle(card);
        const eventCategories = unique(events.map((event) => event.category).filter(Boolean));
        const subtypes = unique(events.map((event) => classifyJournalSubtype(event, card.stage)).filter((subtype) => subtype && subtype !== 'all'));
        const createdAt = firstValue([card && card.createdAt, card && card.date]) || '';
        const updatedAt = firstValue([card && card.updatedAt]) || '';
        const stageChangedAt = firstValue([card && card.extraFields && card.extraFields.stageChangedAt]) || '';
        const searchText = [
          title,
          card.code,
          card.stage,
          card.status,
          card.batchStatus,
          card.currentQuantity,
          card.quantity,
          employee,
          report.reportId,
          lastEvent && lastEvent.title,
          ...events.flatMap((event) => [event.title, event.searchText]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return {
          id: card.cardId || `${report.reportId}-${index + 1}`,
          reportId: report.reportId,
          reportTitle: resolveReportTitle(report),
          reportDate: report.displayCreatedAt || '',
          employee,
          code: card.code || `card-${index + 1}`,
          title,
          cultureLine: [card.cultureName, card.speciesName, card.varietyName].filter(Boolean).join(' · ') || 'Без названия',
          stage: card.stage || 'Без стадии',
          status: card.batchStatus || card.status || '',
          quantity: card.quantity || '',
          currentQuantity: card.currentQuantity || card.quantity || '',
          eventCount: events.length,
          lastEvent,
          lastEventDate: lastEvent ? formatJournalDateOnly(lastEvent.date || lastEvent.createdAt) : '—',
          lastEventTime: lastEvent ? formatJournalTime(lastEvent.date || lastEvent.createdAt) : '',
          hasProblem: events.some((event) => event.category === 'problems'),
          hasPhoto: events.some((event) => event.category === 'photo' || event.photos.length > 0),
          hasLoss: events.some((event) => event.category === 'losses'),
          hasSale: events.some((event) => event.category === 'sales'),
          isImportant: events.some((event) => event.category === 'problems' || event.category === 'losses' || event.category === 'sales'),
          searchText,
          eventCategories,
          subtypes,
          createdAt,
          updatedAt,
          stageChangedAt,
          isVisible: matchesJournalCard(
            {
              events,
              stage: card.stage || 'Без стадии',
              searchText,
              subtypes,
              isImportant: events.some((event) => event.category === 'problems' || event.category === 'losses' || event.category === 'sales')
            },
            search,
            stage,
            tab
          ),
          events
        };
      });
    })
    .sort((left, right) => {
      const leftTime = eventTimestamp(left.lastEvent);
      const rightTime = eventTimestamp(right.lastEvent);
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return String(left.code).localeCompare(String(right.code), 'ru');
    });

  const uniqueCards = [];
  const seenCardIds = new Set();

  sortedCards.forEach((card) => {
    if (seenCardIds.has(card.id)) {
      return;
    }

    seenCardIds.add(card.id);
    uniqueCards.push(card);
  });

  return uniqueCards;
}

function normalizeJournalEvents(report, card) {
  const events = Array.isArray(card && card.events) ? card.events : [];

  return events
    .map((event, index) => normalizeJournalEvent(report, card, event, index))
    .sort((left, right) => eventTimestamp(right) - eventTimestamp(left));
}

function normalizeJournalEvent(report, card, event, index) {
  const createdAt = firstValue([
    event && event.createdAt,
    event && event.date,
    event && event.time,
    event && event.timestamp,
    card && card.updatedAt,
    card && card.createdAt,
    card && card.date
  ]);
  const title = formatJournalEventTitle(event);
  const category = getJournalEventCategory(event);
  const summaryItems = buildJournalEventSummaryItems(event, card);
  const extraFields = buildExtraFieldItems(event && event.extraFields);
  const photos = normalizeJournalPhotoUrls(report, event);
  const createdBy = firstValue([
    event && event.createdBy,
    event && event.author,
    event && event.user,
    event && event.userName
  ]) || 'Неизвестно';
  const comment = firstValue([event && event.comment, event && event.message, event && event.text, event && event.details]) || '';
  const photoNote = firstValue([event && event.photoNote]) || '';
  const problemType = firstValue([event && event.problemType, event && event.problem]) || '';
  const riskLevel = firstValue([event && event.riskLevel, event && event.risk]) || '';
  const quantity = firstValue([event && event.quantity, event && event.count]) || '';
  const searchText = [
    title,
    createdAt,
    category,
    createdBy,
    comment,
    photoNote,
    problemType,
    riskLevel,
    quantity,
    ...summaryItems.flatMap(([label, value]) => [label, value]),
    ...extraFields.flatMap(([label, value]) => [label, value])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    id: firstValue([event && event.eventId]) || `${card && card.cardId ? card.cardId : card.code || 'card'}-${index + 1}`,
    type: firstValue([event && event.type, event && event.eventType, event && event.name]) || '',
    title,
    category,
    categoryLabel: JOURNAL_EVENT_CATEGORY_LABELS[category] || title,
    stage: firstValue([event && event.stage, card && card.stage, card && card.batchStatus, card && card.status]) || 'Без стадии',
    date: createdAt,
    createdAt,
    dateLabel: formatJournalDateOnly(createdAt),
    timeLabel: formatJournalTime(createdAt),
    createdBy,
    comment,
    photoNote,
    problemType,
    riskLevel,
    quantity,
    previousQuantity: firstValue([event && event.previousQuantity]) || '',
    currentQuantity: firstValue([event && event.currentQuantity]) || '',
    summaryItems,
    photos,
    extraFields,
    briefText: buildJournalEventBriefText({ comment, photoNote, problemType, riskLevel, quantity }),
    searchText
  };
}

function buildJournalEventSummaryItems(event, card) {
  const items = [];
  const type = normalizeEventType(event);
  const totalQuantity = Number(firstValue([
    readEventField(event, 'totalQuantity'),
    readEventField(event, 'cardQuantity'),
    card && card.quantity
  ])) || 0;

  const formatCountWithTotal = (value) => {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    return totalQuantity
      ? `${value} из ${totalQuantity} шт.`
      : `${value} шт.`;
  };

  const getValue = (key) => readEventField(event, key);
  const getAliasValue = (keys) => firstValue(keys.map((key) => readEventField(event, key)));

  if (type === 'planting') {
    return [
      ['Место высадки', getValue('plantingLocation')],
      ['Схема посадки', getValue('plantingScheme')],
      ['Площадь / участок', getValue('plotArea')],
      ['Тип грунта', getValue('soilType')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'plantingobservation') {
    return [
      ['Приживаемость', getValue('survivalRate')],
      ['Уровень стресса', getValue('stressLevel')],
      ['Тургор', getValue('turgor')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'plantingcare') {
    return [
      ['Тип ухода', getValue('careType')],
      ['Препарат', getValue('productName')],
      ['Дозировка', getValue('dosage')],
      ['Способ внесения', getValue('applicationMethod')],
      ['Реакция растений', getValue('plantReaction')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'plantingcompletion') {
    return [
      ['Итог высадки', getValue('completionResult')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'batchcreated') {
    return [
      ['Стадия', getValue('stage')],
      ['Количество', getValue('quantity') ? `${getValue('quantity')} шт.` : ''],
      ['QR', getValue('qrStatus')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'stagechange') {
    return [
      ['Укоренено', getValue('rootedCount') ? `${getValue('rootedCount')} шт.` : ''],
      ['Процент укоренения', getValue('rootingPercent') !== '' ? `${getValue('rootingPercent')}%` : ''],
      ['Остаток', getValue('currentQuantity') !== '' ? formatCountWithTotal(getValue('currentQuantity')) : '']
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'qrgenerated') {
    return [
      ['Код', getValue('code')],
      ['QR', getValue('qrStatus')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'statuschange') {
    return getStatusOperationItems(event).map(([label, value]) => [label, `${value} шт.`]);
  }

  if (type === 'movement') {
    return [
      ['Местоположение', `${getAliasValue(['previousLocation']) || 'Не указано'} → ${getAliasValue(['nextLocation']) || 'Не указано'}`],
      ['Комментарий', getValue('comment')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'introloss') {
    return [
      ['Остаток', getValue('previousQuantity') !== '' && getValue('currentQuantity') !== ''
        ? `${getValue('previousQuantity')} → ${getValue('currentQuantity')}`
        : ''],
      ['Причина', getAliasValue(['reason', 'lossReason'])]
    ].filter(([, value]) => Boolean(value));
  }

  if ([
    'rooting',
    'death',
    'discard',
    'sale',
    'propagation',
    'adaptationstress',
    'adaptationenvironment',
    'adaptationhumidityreduction',
    'adaptationcare',
    'greenhouseobservation',
    'greenhousecare',
    'greenhouseenvironment',
    'greenhousedisease',
    'hardeningobservation',
    'hardeningcare',
    'movement',
    'transplant',
    'introloss'
  ].includes(type)) {
    if (type === 'propagation') {
      return [
        ['Добавлено', getValue('count') ? `${getValue('count')} шт.` : ''],
        ['Остаток', getValue('currentQuantity') !== '' ? `${getValue('currentQuantity')} шт.` : ''],
        ['Способ размножения', getValue('propagationMethod')],
        ['Комментарий', getValue('comment')],
        ['Фото', getValue('photoNote')]
      ].filter(([, value]) => Boolean(value));
    }

    return [
      ['Количество', formatCountWithTotal(getValue('count') || getValue('quantity'))],
      ['Причина', getAliasValue(['reason'])],
      ['Тип реализации', getValue('saleType')],
      ['Получатель', getValue('recipient')],
      ['Стоимость', getValue('saleAmount')],
      ['Способ размножения', getValue('propagationMethod')],
      ['Уровень стресса', getValue('stressLevel')],
      ['Состояние', getValue('conditionDescription')],
      ['Температура', getValue('environmentTemperature')],
      ['Влажность воздуха', getAliasValue(['environmentAirHumidity', 'environmentHumidity'])],
      ['Влажность субстрата', getValue('substrateHumidity')],
      ['Снижение влажности', getValue('humidityReduction')],
      ['Освещение', getValue('environmentLight')],
      ['Проветривание', getValue('ventilation')],
      ['Тургор', getValue('turgor')],
      ['Стабильность', getValue('stability')],
      ['Уход', getValue('careType')],
      ['Интервал ухода', getValue('careIntervalDays') ? `${getValue('careIntervalDays')} дн.` : ''],
      ['Скорость роста', getValue('growthRate')],
      ['Уровень риска', getValue('riskLevel')],
      ['Болезнь', getValue('diseaseName')],
      ['Вредитель', getValue('pestName')],
      ['Степень поражения', getValue('diseaseSeverity')],
      ['Объем полива', getValue('waterVolume')],
      ['Интервал полива', getValue('wateringIntervalDays') ? `${getValue('wateringIntervalDays')} дн.` : ''],
      ['Препарат', getValue('productName')],
      ['Дозировка', getValue('dosage')],
      ['Способ', getValue('applicationMethod')],
      ['Реакция растений', getValue('plantReaction')],
      ['Размещение', getValue('placement')],
      ['Плотность', getValue('densityChange')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'comment') {
    return [['Комментарий', getValue('comment')]].filter(([, value]) => Boolean(value));
  }

  if (type === 'photo') {
    return [['Фото', getValue('photoNote')]].filter(([, value]) => Boolean(value));
  }

  if (type === 'problem') {
    return [
      ['Тип проблемы', getValue('problemType')],
      ['Уровень риска', getValue('riskLevel')],
      ['Описание проблемы', getValue('problemDescription')],
      ['Комментарий', getValue('comment')],
      ['Фото', getValue('photoNote')]
    ].filter(([, value]) => Boolean(value));
  }

  if (type === 'contamination') {
    return [['Описание', getValue('contaminationNote')]].filter(([, value]) => Boolean(value));
  }

  if (type === 'quarantine') {
    return [['Причина', getAliasValue(['quarantineReason', 'reason'])]].filter(([, value]) => Boolean(value));
  }

  if (type === 'quarantinereleased') {
    return [['Причина снятия', getValue('reason')]].filter(([, value]) => Boolean(value));
  }

  return items;
}

function getStatusOperationItems(operation) {
  if (!operation) {
    return [];
  }

  return [
    ['Укоренение', readEventField(operation, 'rootedCount')],
    ['Размножение', readEventField(operation, 'propagationCount')],
    ['Продажа', readEventField(operation, 'saleCount')],
    ['Гибель', readEventField(operation, 'deathCount')],
    ['Выбраковка', readEventField(operation, 'discardCount')]
  ].filter(([, value]) => Number(value) > 0);
}

function buildExtraFieldItems(extraFields) {
  if (!extraFields || typeof extraFields !== 'object' || Array.isArray(extraFields)) {
    return [];
  }

  return Object.entries(extraFields)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => [humanizeKey(key), String(value)]);
}

function buildJournalEventBriefText({ comment, photoNote, problemType, riskLevel, quantity }) {
  if (comment) return comment;
  if (photoNote) return photoNote;
  if (problemType) return `Проблема: ${problemType}`;
  if (riskLevel) return `Риск: ${riskLevel}`;
  if (quantity !== '' && quantity !== null && quantity !== undefined) return `Количество: ${quantity} шт.`;
  return '';
}

function buildStageFilters(cards) {
  const counts = new Map(JOURNAL_STAGE_ORDER.map((stage) => [stage, 0]));

  for (const card of cards) {
    const key = card.stage || 'Без стадии';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [
    { key: 'all', label: JOURNAL_STAGE_LABELS.all, count: cards.length },
    ...JOURNAL_STAGE_ORDER.map((stage) => ({
      key: stage,
      label: JOURNAL_STAGE_LABELS[stage],
      count: counts.get(stage) || 0
    }))
  ];
}

function buildStageTabs(cards, selectedStage) {
  return JOURNAL_STAGE_TAB_ORDER.map((stageKey) => ({
    key: stageKey,
    label: JOURNAL_STAGE_TAB_LABELS[stageKey] || stageKey,
    count: stageKey === 'all'
      ? cards.length
      : stageKey === 'important'
        ? cards.filter((card) => Boolean(card.isImportant)).length
        : cards.filter((card) => sameStage(card.stage, stageKey)).length,
    active: stageKey === selectedStage
  }));
}

function buildEmployeeTabs(cards) {
  const counts = new Map();
  const labels = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    const key = resolveJournalEmployee(card.employee);
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
    if (!labels.has(key)) {
      labels.set(key, card.employee);
    }
  }

  const sortedKeys = [...counts.keys()].sort((left, right) => {
    const leftLabel = labels.get(left) || left;
    const rightLabel = labels.get(right) || right;
    return leftLabel.localeCompare(rightLabel, 'ru');
  });

  return [
    { key: 'all', label: 'Все сотрудники', count: cards.length, active: true },
    ...sortedKeys.map((key) => ({
      key,
      label: labels.get(key) || key,
      count: counts.get(key) || 0,
      active: false
    }))
  ];
}

function buildSubtabTabs(cards, selectedStage, selectedSubtab) {
  const scopedCards = selectedStage === 'important'
    ? cards.filter((card) => Boolean(card.isImportant))
    : selectedStage && selectedStage !== 'all'
      ? cards.filter((card) => sameStage(card.stage, selectedStage))
      : cards;
  const counts = new Map();

  for (const card of scopedCards) {
    for (const subtype of Array.isArray(card.subtypes) ? card.subtypes : []) {
      counts.set(subtype, (counts.get(subtype) || 0) + 1);
    }
  }

  return JOURNAL_SUBTAB_ORDER.map((subtabKey) => ({
    key: subtabKey,
    label: JOURNAL_SUBTAB_LABELS[subtabKey] || subtabKey,
    count: subtabKey === 'all' ? scopedCards.length : counts.get(subtabKey) || 0,
    active: subtabKey === selectedSubtab
  }));
}

function matchesJournalCard(card, search, stage, tab) {
  if (!card || !card.events.length) {
    return false;
  }

  const normalizedSearch = String(search || '').trim().toLowerCase();
  if (stage === 'important') {
    if (!card.isImportant) {
      return false;
    }
  } else if (stage !== 'all' && card.stage !== stage) {
    return false;
  }

  if (normalizedSearch && !card.searchText.includes(normalizedSearch)) {
    return false;
  }

  if (tab !== 'all' && !(Array.isArray(card.subtypes) && card.subtypes.includes(tab))) {
    return false;
  }

  return true;
}

function matchesJournalEvent(event, tab) {
  if (!event) {
    return false;
  }

  if (tab === 'all') {
    return true;
  }

  return getJournalEventCategory(event) === tab;
}

function classifyJournalSubtype(event, stage) {
  const haystack = [
    event && event.type,
    event && event.comment,
    event && event.photoNote,
    event && event.problemType,
    event && event.riskLevel
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (looksProblemLike(event && event.type, event && event.comment, event && event.photoNote, event && event.problemType, event && event.riskLevel)) {
    return 'problems';
  }

  if (containsAny(haystack, ['списан', 'writeoff', 'loss', 'death', 'discard', 'потер', 'гибель'])) {
    return 'losses';
  }

  if (containsAny(haystack, ['продаж', 'sale', 'sold', 'реализац'])) {
    return 'sales';
  }

  if (containsAny(haystack, ['перемещ', 'transfer', 'move', 'relocat'])) {
    return 'movement';
  }

  if (stage === 'Клонирование') {
    if (containsAny(haystack, ['root', 'укорен'])) return 'rooting';
    if (containsAny(haystack, ['размнож', 'propagat', 'делен'])) return 'propagation';
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (stage === 'Адаптация' || stage === 'Теплица' || stage === 'Закалка') {
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (stage === 'Теплица' && containsAny(haystack, ['пересад', 'transplant'])) {
    return 'transplant';
  }

  if (stage === 'Высадка') {
    if (containsAny(haystack, ['высад', 'plant', 'planting'])) return 'planting';
    if (containsAny(haystack, ['заверш', 'complete', 'finish', 'done'])) return 'completion';
    if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) return 'observation';
    if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) return 'care';
  }

  if (containsAny(haystack, ['наблюд', 'осмотр', 'check', 'inspect', 'photo'])) {
    return 'observation';
  }

  if (containsAny(haystack, ['уход', 'care', 'полив', 'watering', 'feed', 'подкорм'])) {
    return 'care';
  }

  return 'all';
}

function getJournalEventCategory(event) {
  const normalized = normalizeEventType(event);

  if (!normalized) {
    return 'other';
  }

  if (normalized === 'photo' || normalized === 'photos') return 'photo';
  if (['plantingobservation', 'hardeningobservation', 'greenhouseobservation', 'adaptationstress'].includes(normalized)) return 'observation';
  if (['adaptationcare', 'greenhousecare', 'hardeningcare', 'plantingcare'].includes(normalized)) return 'care';
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease'].includes(normalized)) return 'problems';
  if (['movement', 'stagechange', 'statuschange', 'transplant'].includes(normalized)) return 'movement';
  if (['introloss', 'death', 'discard'].includes(normalized)) return 'losses';
  if (normalized === 'sale') return 'sales';

  return 'other';
}

function formatJournalEventTitle(event) {
  const rawType = firstValue([event && event.title, event && event.type, event && event.eventType, event && event.name]);
  if (!rawType) {
    return 'Событие';
  }

  const normalized = normalizeEventType(event);
  const labels = {
    photo: 'Фото',
    photos: 'Фото',
    batchcreated: 'Создание партии',
    stagechange: 'Изменение стадии',
    statuschange: 'Изменение стадии',
    movement: 'Перемещение',
    sale: 'Продажа',
    introloss: 'Потери',
    death: 'Потери',
    discard: 'Списание',
    propagation: 'Размножение',
    rooting: 'Укоренение',
    transplant: 'Пересадка',
    planting: 'Высадка',
    plantingobservation: 'Наблюдение',
    plantingcare: 'Уход',
    plantingcompletion: 'Завершение',
    greenhouseobservation: 'Наблюдение',
    greenhousecare: 'Уход',
    greenhousedisease: 'Болезнь',
    greenhousestress: 'Стресс',
    hardeningobservation: 'Наблюдение',
    hardeningcare: 'Уход',
    adaptationstress: 'Наблюдение',
    adaptationcare: 'Уход',
    contamination: 'Контаминация',
    quarantine: 'Карантин',
    quarantinereleased: 'Снятие с карантина',
    problem: 'Проблема'
  };

  return labels[normalized] || rawType;
}

function formatJournalCardTitle(card) {
  return [card && card.cultureName, card && card.speciesName, card && card.varietyName]
    .filter(Boolean)
    .join(' · ') || (card && card.code) || 'Карточка';
}

function formatJournalDateOnly(value) {
  const date = toDate(value);
  if (!date) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatJournalTime(value) {
  const date = toDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function normalizeJournalPhotoUrls(report, event) {
  const rawPhotos = Array.isArray(event && event.photos) ? event.photos : [];
  const photoUrls = [];

  for (const photo of rawPhotos) {
    if (typeof photo !== 'string' || !photo.trim()) {
      continue;
    }

    if (photo.includes('://')) {
      photoUrls.push(photo);
      continue;
    }

    if (report && typeof report.getPhotoUrl === 'function') {
      photoUrls.push(report.getPhotoUrl(photo));
    }
  }

  return photoUrls;
}

function resolveJournalStage(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'all') {
    return 'all';
  }

  return JOURNAL_STAGE_ORDER.find((stage) => stage.toLowerCase() === normalized.toLowerCase()) || 'all';
}

function resolveJournalTab(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'all') {
    return 'all';
  }

  return JOURNAL_SUBTAB_ORDER.find((tab) => tab === normalized) || 'all';
}

function sameStage(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function resolveSelectedCardId(value, visibleCards) {
  const normalized = String(value || '').trim();
  if (normalized && Array.isArray(visibleCards) && visibleCards.some((card) => card.id === normalized)) {
    return normalized;
  }

  return '';
}

function resolveJournalEmployee(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveReportTitle(report) {
  if (!report) {
    return 'Журнал';
  }

  const userName = report.user && (report.user.displayName || [report.user.firstName, report.user.lastName].filter(Boolean).join(' '));
  return userName || report.reportId || 'Журнал';
}

function resolveReportEmployee(report) {
  if (!report) {
    return 'Неизвестно';
  }

  const userName = report.user && (report.user.displayName || [report.user.firstName, report.user.lastName].filter(Boolean).join(' ').trim());
  return userName || report.author || report.userName || 'Неизвестно';
}

function eventTimestamp(event) {
  return toDate(event && (event.createdAt || event.date || event.time || event.timestamp))?.getTime() || 0;
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValue(values) {
  const list = Array.isArray(values) ? values : [values];

  for (const value of list) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return '';
}

function readEventField(event, key) {
  if (!event) {
    return '';
  }

  const extraFields = event.extraFields && typeof event.extraFields === 'object' && !Array.isArray(event.extraFields)
    ? event.extraFields
    : null;
  return firstValue([event[key], extraFields ? extraFields[key] : '']);
}

function normalizeEventType(event) {
  return String(firstValue([event && event.type, event && event.eventType, event && event.name, event && event.title]) || '')
    .toLowerCase()
    .replace(/[^a-zа-яё]/g, '');
}

function unique(values) {
  return [...new Set(values)];
}

function containsAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

function looksProblemLike(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return containsAny(text, ['problem', 'risk', 'карантин', 'контамин', 'issue', 'warning']);
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  buildJournalPageModel,
  JOURNAL_STAGE_ORDER,
  JOURNAL_STAGE_LABELS,
  JOURNAL_TAB_ORDER,
  JOURNAL_TAB_LABELS,
  buildEmployeeTabs,
  formatJournalEventTitle,
  formatJournalCardTitle,
  formatJournalDateOnly,
  formatJournalTime,
  getJournalEventCategory,
  matchesJournalCard,
  matchesJournalEvent
};
