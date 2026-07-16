const STAGES = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const CATEGORY_DEFINITIONS = [
  ['all', 'Все события'],
  ['observation', 'Наблюдения'],
  ['care', 'Уход'],
  ['problems', 'Проблемы'],
  ['movement', 'Перемещения'],
  ['losses', 'Потери'],
  ['sales', 'Продажи'],
  ['rooting', 'Укоренение'],
  ['propagation', 'Размножение'],
  ['transplant', 'Пересадка'],
  ['planting', 'Высадка'],
  ['completion', 'Завершение']
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_DEFINITIONS);
const AUTOMATIC_EVENT_TYPES = new Set([
  'batchcreated',
  'qrgenerated',
  'stagesettingsupdated'
]);
const REPORT_USER_ALIASES = ['local-user'];
const UNKNOWN_AUTHOR_VALUES = new Set(['неизвестно', 'unknown', 'unknown-user']);
const DISPLAY_TIME_ZONE = 'Europe/Moscow';
const PERIOD_OPTIONS = [
  ['all', 'Все время'],
  ['today', 'Сегодня'],
  ['7d', 'Неделя'],
  ['30d', 'Месяц'],
  ['custom', 'Выбрать период']
];

function buildJournalPageModel(reports = [], query = {}) {
  const allEvents = buildGlobalJournal(reports);
  const filters = resolveFilters(query);
  const events = filterJournalEvents(allEvents, filters);
  const groups = groupEventsByDate(events);

  return {
    events,
    groups,
    filters,
    hasEvents: allEvents.length > 0,
    hasResults: events.length > 0,
    periodOptions: PERIOD_OPTIONS.map(([value, label]) => ({ value, label })),
    employeeOptions: buildEmployeeOptions(allEvents),
    categoryOptions: CATEGORY_DEFINITIONS.map(([value, label]) => ({ value, label })),
    stageOptions: ['all', ...STAGES].map((value) => ({ value, label: value === 'all' ? 'Все стадии' : value })),
    summary: {
      total: events.length,
      problems: events.filter((event) => event.category === 'problems').length,
      losses: events.filter((event) => event.category === 'losses').length,
      sales: events.filter((event) => event.category === 'sales').length,
      lostPlants: sumEventQuantity(events, 'losses'),
      soldPlants: sumEventQuantity(events, 'sales'),
      photos: events.filter((event) => event.hasPhotos).length
    }
  };
}

function buildGlobalJournal(reports = []) {
  const events = [];
  const employees = buildEmployeeDirectory(reports);

  for (const report of Array.isArray(reports) ? reports : []) {
    const cards = Array.isArray(report && report.cards) ? report.cards : [];
    const rawCards = Array.isArray(report && report.raw && report.raw.cards) ? report.raw.cards : [];

    cards.forEach((card, cardIndex) => {
      const rawEvents = Array.isArray(rawCards[cardIndex] && rawCards[cardIndex].events)
        ? rawCards[cardIndex].events
        : [];
      const cardEvents = Array.isArray(card && card.events) ? card.events : [];

      cardEvents.forEach((event, eventIndex) => {
        const normalizedEvent = normalizeJournalEvent(event, card, report, rawEvents[eventIndex], eventIndex, employees);
        if (isPlantEvent(normalizedEvent)) events.push(normalizedEvent);
      });
    });
  }

  return deduplicateEvents(events).sort((left, right) => right.timestamp - left.timestamp);
}

function deduplicateEvents(events = []) {
  const uniqueEvents = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const key = event.sourceEventId
      ? `id:${event.sourceEventId}`
      : `fallback:${event.cardId}|${event.type}|${event.date}|${event.createdBy}|${event.title}|${event.comment}`.toLowerCase();
    const existing = uniqueEvents.get(key);

    // Snapshots may contain the same event with a newer batch state. Keep the newest source.
    if (!existing || event.snapshotTimestamp >= existing.snapshotTimestamp) {
      uniqueEvents.set(key, event);
    }
  }

  return [...uniqueEvents.values()];
}

function normalizeJournalEvent(event = {}, card = {}, report = {}, rawEvent = {}, index = 0, employees = new Map()) {
  const date = firstValue([event.createdAt, event.timestamp, event.time, event.date, card.updatedAt, report.createdAt]);
  const type = firstValue([event.type, event.eventType, event.name]) || 'unknown';
  const sourceEventId = firstValue([rawEvent && rawEvent.eventId]);
  const eventId = sourceEventId || firstValue([event.eventId]) || `${card.cardId || card.code || 'card'}-${index + 1}`;
  const photos = normalizePhotoUrls(report, event);
  const category = getEventCategory(event, photos.length > 0);
  const title = formatJournalEventTitle(event, category);
  const rawCreatedById = firstValue([event.createdBy, event.author, event.user, event.userName]);
  const createdById = isUnknownAuthor(rawCreatedById) ? firstValue([report.user && report.user.userId]) : rawCreatedById;
  const createdBy = employees.get(normalizeText(createdById)) || createdById || firstValue([report.user && report.user.displayName]) || 'Неизвестно';
  const cardId = String(card.cardId || card.code || '').trim();
  const culture = [card.cultureName, card.speciesName, card.varietyName].filter(isVisiblePlantPart).join(' · ') || card.code || 'Партия без названия';
  const stage = firstValue([event.stage, card.stage, card.batchStatus, card.status]) || 'Без стадии';
  const comment = firstValue([event.comment, event.message, event.text, event.details]);
  const details = buildEventDetails(event, category);
  const quantity = getEventQuantity(event);

  return {
    id: eventId,
    sourceEventId,
    cardId,
    code: firstValue([card.code, card.partyCode, cardId]) || 'Без кода',
    culture,
    stage,
    type,
    title,
    category,
    categoryLabel: CATEGORY_LABELS[category] || title,
    date,
    timeLabel: formatJournalTime(date),
    timestamp: toTimestamp(date),
    snapshotTimestamp: toTimestamp(firstValue([card.updatedAt, report.createdAt, date])),
    createdBy,
    createdById,
    comment,
    details,
    quantity,
    photos,
    hasPhotos: photos.length > 0,
    isImportant: isImportantEvent(event, category),
    searchText: [cardId, card.code, culture, stage, title, type, createdBy, comment, ...details.flatMap((item) => [item.label, item.value])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    batchUrl: `/stages?cardId=${encodeURIComponent(cardId)}&tab=journal&eventId=${encodeURIComponent(eventId)}#journal`
  };
}

function sumEventQuantity(events, category) {
  return events
    .filter((event) => event.category === category)
    .reduce((total, event) => total + event.quantity, 0);
}

function getEventQuantity(event) {
  const value = Number(readEventField(event, 'count') || readEventField(event, 'quantity'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function buildEmployeeDirectory(reports = []) {
  const employees = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    const user = report && report.user ? report.user : {};
    const displayName = firstValue([user.displayName, [user.firstName, user.lastName].filter(Boolean).join(' ')]);
    for (const identifier of [user.userId, report && report.author, report && report.userName, ...REPORT_USER_ALIASES]) {
      if (identifier && displayName) employees.set(normalizeText(identifier), displayName);
    }
  }
  return employees;
}

function getEventCategory(event = {}, hasPhotos = false) {
  const type = normalizeType(event);
  if (['observation', 'adaptationstress', 'greenhouseobservation', 'hardeningobservation', 'plantingobservation'].includes(type)) return 'observation';
  if (['care', 'adaptationcare', 'greenhousecare', 'hardeningcare', 'plantingcare'].includes(type)) return 'care';
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease'].includes(type)) return 'problems';
  if (['movement', 'stagechange', 'statuschange'].includes(type)) return 'movement';
  if (['introloss', 'loss', 'death', 'discard'].includes(type)) return 'losses';
  if (type === 'sale') return 'sales';
  if (type === 'rooting') return 'rooting';
  if (type === 'propagation') return 'propagation';
  if (type === 'transplant') return 'transplant';
  if (type === 'planting') return 'planting';
  if (type === 'plantingcompletion' || type === 'completion') return 'completion';
  if (type === 'photo' || type === 'photos' || (hasPhotos && !type)) return 'photo';
  return 'other';
}

function isPlantEvent(event) {
  return !AUTOMATIC_EVENT_TYPES.has(normalizeType(event));
}

function filterJournalEvents(events = [], filters = {}) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!matchesPeriod(event.timestamp, filters)) return false;
    if (filters.employee !== 'all' && normalizeText(event.createdBy) !== normalizeText(filters.employee)) return false;
    if (filters.category !== 'all' && event.category !== filters.category) return false;
    if (filters.stage !== 'all' && normalizeText(event.stage) !== normalizeText(filters.stage)) return false;
    if (filters.query && !event.searchText.includes(filters.query.toLowerCase())) return false;
    if (filters.quick === 'important' && !event.isImportant) return false;
    if (filters.quick === 'problems' && event.category !== 'problems') return false;
    if (filters.quick === 'losses' && event.category !== 'losses') return false;
    if (filters.quick === 'sales' && event.category !== 'sales') return false;
    if (filters.quick === 'photos' && !event.hasPhotos) return false;
    return true;
  });
}

function groupEventsByDate(events = []) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const key = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : 'unknown';
    if (!groups.has(key)) groups.set(key, { key, label: formatJournalDate(event.date), events: [] });
    groups.get(key).events.push(event);
  }

  return [...groups.values()]
    .sort((left, right) => right.key.localeCompare(left.key))
    .map((group) => ({ ...group, events: group.events.sort((left, right) => right.timestamp - left.timestamp) }));
}

function formatJournalDate(value) {
  const date = toDate(value);
  if (!date) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(date);
}

function formatJournalTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIME_ZONE }).format(date);
}

function resolveFilters(query = {}) {
  const hasRange = Boolean(String(query.dateFrom || '').trim() || String(query.dateTo || '').trim());
  const period = PERIOD_OPTIONS.some(([value]) => value === query.period) ? query.period : hasRange ? 'custom' : 'all';
  return {
    period,
    dateFrom: String(query.dateFrom || '').trim(),
    dateTo: String(query.dateTo || '').trim(),
    employee: String(query.employee || 'all').trim() || 'all',
    category: CATEGORY_LABELS[query.category] ? String(query.category) : 'all',
    stage: STAGES.includes(String(query.stage || '').trim()) ? String(query.stage).trim() : 'all',
    query: String(query.q || '').trim(),
    quick: ['important', 'problems', 'losses', 'sales', 'photos'].includes(String(query.quick || '')) ? String(query.quick) : 'all'
  };
}

function buildEmployeeOptions(events) {
  return ['all', ...new Set(events.map((event) => event.createdBy).filter((value) => value && value !== 'Неизвестно'))]
    .map((value) => ({ value, label: value === 'all' ? 'Все сотрудники' : value }));
}

function matchesPeriod(timestamp, filters) {
  if (!timestamp) return filters.period === 'all';
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  if (filters.period === 'today') return timestamp >= today && timestamp < today + 86400000;
  if (filters.period === '7d') return timestamp >= today - 6 * 86400000;
  if (filters.period === '30d') return timestamp >= today - 29 * 86400000;
  if (filters.period === 'custom') {
    const from = toTimestamp(filters.dateFrom);
    const to = toTimestamp(filters.dateTo);
    if (from && timestamp < from) return false;
    if (to && timestamp >= to + 86400000) return false;
  }
  return true;
}

function buildEventDetails(event, category) {
  const get = (key) => readEventField(event, key);
  const type = normalizeType(event);
  const items = [];
  const push = (label, value) => {
    const text = formatValue(value);
    if (text && !items.some((item) => item.label === label && item.value === text)) items.push({ label, value: text });
  };

  if (category === 'losses') {
    push('Потеряно', withUnits(get('count') || get('quantity')));
    push('Было', withUnits(get('previousQuantity')));
    push('Остаток', withUnits(get('currentQuantity')));
    push('Причина', get('reason') || get('lossReason'));
  } else if (category === 'sales') {
    push('Продано', withUnits(get('count') || get('quantity')));
    push('Было', withUnits(get('previousQuantity')));
    push('Остаток', withUnits(get('currentQuantity')));
    push('Получатель', get('recipient'));
    push('Стоимость', get('saleAmount'));
  } else if (category === 'propagation') {
    push('Добавлено', withUnits(get('count') || get('quantity')));
    push('Было', withUnits(get('previousQuantity')));
    push('Стало', withUnits(get('currentQuantity')));
    push('Способ размножения', get('propagationMethod'));
  } else if (category === 'problems') {
    push('Тип проблемы', get('problemType') || get('problem'));
    push('Риск', get('riskLevel') || get('risk'));
    push('Описание', get('problemDescription') || get('diseaseName') || get('pestName') || get('reason') || get('quarantineReason'));
  } else if (category === 'movement' || category === 'transplant') {
    push('Откуда', get('previousLocation'));
    push('Куда', get('nextLocation'));
  }

  const fields = [
    ['Укоренено', 'rootedCount', true], ['Процент укоренения', 'rootingPercent', false, '%'],
    ['Тип ухода', 'careType'], ['Препарат', 'productName'], ['Дозировка', 'dosage'], ['Способ внесения', 'applicationMethod'],
    ['Реакция растений', 'plantReaction'], ['Уровень стресса', 'stressLevel'], ['Тургор', 'turgor'], ['Стабильность', 'stability'],
    ['Температура', 'environmentTemperature'], ['Влажность воздуха', 'environmentAirHumidity'], ['Влажность субстрата', 'substrateHumidity'],
    ['Освещение', 'environmentLight'], ['Проветривание', 'ventilation'], ['Скорость роста', 'growthRate'], ['Состояние', 'conditionDescription'],
    ['Место высадки', 'plantingLocation'], ['Схема посадки', 'plantingScheme'], ['Площадь', 'plotArea'], ['Тип грунта', 'soilType'],
    ['Итог', 'completionResult'], ['Болезнь', 'diseaseName'], ['Вредитель', 'pestName'], ['Степень поражения', 'diseaseSeverity']
  ];
  fields.forEach(([label, key, quantity, suffix]) => {
    const value = get(key);
    push(label, quantity ? withUnits(value) : suffix && value !== '' ? `${value}${suffix}` : value);
  });

  if (type === 'stagechange') {
    push('Из стадии', get('fromStage'));
    push('В стадию', get('toStage'));
  }

  return items;
}

function formatJournalEventTitle(event, category) {
  const type = normalizeType(event);
  const labels = {
    batchcreated: 'Создание партии', stagechange: 'Изменение стадии', statuschange: 'Изменение статуса', movement: 'Перемещение',
    sale: 'Продажа', introloss: 'Потери', loss: 'Потери', death: 'Гибель', discard: 'Списание', propagation: 'Размножение',
    rooting: 'Укоренение', transplant: 'Пересадка', planting: 'Высадка', plantingobservation: 'Наблюдение', plantingcare: 'Уход',
    plantingcompletion: 'Завершение', greenhouseobservation: 'Наблюдение', greenhousecare: 'Уход', greenhousedisease: 'Болезнь',
    hardeningobservation: 'Наблюдение', hardeningcare: 'Уход', adaptationstress: 'Наблюдение', adaptationcare: 'Уход',
    contamination: 'Контаминация', quarantine: 'Карантин', quarantinereleased: 'Снятие с карантина', problem: 'Проблема', photo: 'Фото'
  };
  return labels[type] || firstValue([event.title]) || CATEGORY_LABELS[category] || 'Событие';
}

function normalizePhotoUrls(report, event) {
  const values = [event && event.photos, event && event.photoFiles, event && event.photoPaths, event && event.photoUri, event && event.photoUris]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string' && value.trim());
  return [...new Set(values.map((photo) => photo.includes('://') ? photo : report && typeof report.getPhotoUrl === 'function' ? report.getPhotoUrl(photo) : '').filter(Boolean))];
}

function isImportantEvent(event, category) {
  return ['problems', 'losses', 'sales'].includes(category) || normalizeType(event) === 'stagechange' || /critical|высок/i.test(`${readEventField(event, 'riskLevel')} ${readEventField(event, 'risk')}`);
}

function readEventField(event, key) {
  const extra = event && event.extraFields && typeof event.extraFields === 'object' ? event.extraFields : {};
  return firstValue([event && event[key], extra[key]]);
}

function normalizeType(event) {
  return String(firstValue([event && event.type, event && event.eventType, event && event.name]) || '').toLowerCase().replace(/[^a-zа-яё]/g, '');
}

function firstValue(values) {
  for (const value of Array.isArray(values) ? values : [values]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function withUnits(value) {
  const text = formatValue(value);
  return text && text !== '0' ? `${text} шт.` : '';
}

function formatValue(value) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return '';
  return String(value).trim();
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isUnknownAuthor(value) {
  return UNKNOWN_AUTHOR_VALUES.has(normalizeText(value));
}

function toDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTimestamp(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

module.exports = {
  STAGES,
  buildJournalPageModel,
  buildGlobalJournal,
  buildEmployeeDirectory,
  deduplicateEvents,
  normalizeJournalEvent,
  getEventCategory,
  isPlantEvent,
  filterJournalEvents,
  groupEventsByDate,
  formatJournalDate,
  formatJournalTime
};
