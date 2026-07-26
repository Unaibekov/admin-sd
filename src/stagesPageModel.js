const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const STAGE_LABELS = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage]));

function buildStagesPageModel(reports = [], query = {}) {
  const cards = buildBatchCatalog(reports);
  const search = String(query.q || '').trim();
  const requestedStage = String(query.stage || '').trim();
  const stage = requestedStage === 'all' || STAGE_ORDER.includes(requestedStage) ? (requestedStage || 'all') : 'all';
  const employeeOptions = buildEmployeeOptions(cards);
  const requestedEmployee = String(query.employee || '').trim();
  const employee = employeeOptions.some((item) => item.key === requestedEmployee) ? requestedEmployee : 'all';
  const filteredCards = cards.filter((card) => {
    const matchesStage = !stage || stage === 'all' || card.stage === stage;
    const matchesEmployee = employee === 'all' || card.employeeKey === employee;
    const matchesSearch = !search || card.searchText.includes(search.toLowerCase());
    return matchesStage && matchesEmployee && matchesSearch;
  });
  const requestedBatchKey = String(query.batchId || '').trim();
  const requestedCardId = String(query.cardId || '').trim();
  const selectedTab = ['passport', 'journal'].includes(String(query.tab || '').trim())
    ? String(query.tab).trim()
    : 'journal';
  const highlightedEventId = String(query.eventId || '').trim();
  const selectedCard = filteredCards.find((card) => card.batchKey === requestedBatchKey)
    || (!requestedBatchKey && filteredCards.find((card) => card.cardId === requestedCardId))
    || null;

  return {
    pageTitle: 'Партии',
    search,
    selectedStage: stage || 'all',
    selectedEmployee: employee,
    selectedCardId: selectedCard ? selectedCard.cardId : '',
    selectedBatchKey: selectedCard ? selectedCard.batchKey : '',
    selectedTab,
    highlightedEventId,
    cards: filteredCards,
    selectedCard,
    stages: [
      { key: 'all', label: 'Все партии', count: cards.length },
      ...STAGE_ORDER.map((key) => ({
        key,
        label: STAGE_LABELS[key],
        count: cards.filter((card) => card.stage === key).length
      }))
    ],
    employees: employeeOptions
  };
}

function buildEmployeeOptions(cards) {
  const employees = new Map();
  cards.forEach((card) => {
    if (!card.employeeKey || !card.employeeName) return;
    const employee = employees.get(card.employeeKey) || { key: card.employeeKey, label: card.employeeName, count: 0 };
    employee.count += 1;
    employees.set(card.employeeKey, employee);
  });

  return [
    { key: 'all', label: 'Все сотрудники', count: cards.length },
    ...[...employees.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  ];
}

function buildBatchCatalog(reports) {
  const byKey = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    const rawCards = Array.isArray(report && report.raw && report.raw.cards)
      ? report.raw.cards
      : Array.isArray(report && report.cards) ? report.cards : [];
    rawCards.forEach((rawCard, index) => {
      const parsedCard = report.cards && report.cards[index] ? report.cards[index] : {};
      const cardId = String(rawCard.cardId || parsedCard.cardId || rawCard.code || parsedCard.code || `${report.reportId}-${index + 1}`);
      const normalized = normalizeCard(rawCard, parsedCard, report, index);
      const existing = byKey.get(normalized.batchKey);
      if (!existing || normalized.snapshotAt >= existing.snapshotAt) {
        byKey.set(normalized.batchKey, {
          ...(existing || {}),
          ...normalized,
          events: deduplicateEvents([...(existing ? existing.events : []), ...normalized.events])
        });
      } else {
        existing.events = deduplicateEvents([...existing.events, ...normalized.events]);
      }
    });
  }
  return [...byKey.values()]
    .map((card) => ({ ...card, events: card.events.sort((a, b) => eventTime(b) - eventTime(a)) }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

function normalizeCard(raw, parsed, report, index) {
  const titleParts = [raw.cultureName || parsed.culture, raw.speciesName, raw.varietyName || parsed.variety || parsed.sort].filter(isVisiblePlantPart);
  const events = Array.isArray(raw.events) ? raw.events : Array.isArray(parsed.events) ? parsed.events : [];
  const snapshotAt = resolveSnapshotAt(raw, parsed, report, events);
  const currentQuantity = raw.currentQuantity ?? raw.currentCount ?? raw.remainingCount ?? parsed.currentCount ?? raw.quantity ?? parsed.initialCount;
  const initialQuantity = raw.initialQuantity ?? raw.initialCount ?? raw.quantity ?? parsed.initialCount;
  const stage = String(raw.stage || parsed.stage || '').trim() || 'Без стадии';
  const status = String(raw.batchStatus || raw.status || parsed.status || 'Не указан').trim();
  const statusLabel = formatBatchStatus(status);
  const sterilityStatus = String(raw.sterilityStatus || parsed.sterilityStatus || '').trim();
  const location = raw.locationDescription || raw.location || raw.place || parsed.location || '';
  const problemType = raw.problemType || raw.problem || parsed.problemType || parsed.problem || '';
  const riskLevel = raw.riskLevel || raw.risk || parsed.riskLevel || parsed.risk || '';
  const activeProblemQuantity = raw.activeProblemQuantity ?? parsed.activeProblemQuantity ?? '';
  const healthyQuantity = raw.healthyQuantity ?? parsed.healthyQuantity ?? '';
  const sourceQuantity = raw.sourceQuantity ?? parsed.sourceQuantity ?? '';
  const propagationQuantity = raw.propagationQuantity ?? parsed.propagationQuantity ?? '';
  const originType = raw.originType || parsed.originType || '';
  const parentCardId = raw.parentCardId || parsed.parentCardId || '';
  const parentCode = raw.parentCode || parsed.parentCode || '';
  const sourceEventId = raw.sourceEventId || parsed.sourceEventId || '';
  const generation = raw.generation ?? parsed.generation ?? '';
  const propagatedAt = raw.propagatedAt || parsed.propagatedAt || '';
  const propagationMethod = raw.propagationMethod || parsed.propagationMethod || '';
  const stageChangedAt = raw.stageChangedAt || parsed.stageChangedAt || '';
  const code = String(raw.code || parsed.code || `card-${index + 1}`);
  const cardId = String(raw.cardId || parsed.cardId || code);
  const qrStatus = raw.qrStatus || parsed.qrStatus || (raw.qrPrinted || parsed.qrPrinted ? 'printed' : code ? 'pending_print' : 'none');
  const deviceId = String(report.deviceId || '').trim();
  const employeeName = String(report && report.user && (report.user.displayName || [report.user.firstName, report.user.lastName].filter(Boolean).join(' ')) || '').trim() || 'Сотрудник не указан';
  const employeeKey = String(report && report.user && (report.user.userId || report.user.displayName) || '').trim().toLowerCase();
  const batchKey = buildBatchKey(deviceId, cardId, report.reportId);
  const eventContext = {
    ...parsed,
    ...raw,
    stage,
    quantity: raw.quantity ?? parsed.quantity ?? initialQuantity ?? currentQuantity,
    currentQuantity,
    initialQuantity,
    qrStatus
  };
  const eventList = events.map((event) => normalizeEvent(event, report, eventContext));

  return {
    cardId,
    batchKey,
    deviceId,
    code,
    title: titleParts.length ? titleParts.join(' · ') : code,
    culture: isVisiblePlantPart(raw.cultureName || parsed.culture) ? raw.cultureName || parsed.culture : '',
    species: isVisiblePlantPart(raw.speciesName) ? raw.speciesName : '',
    variety: isVisiblePlantPart(raw.varietyName || parsed.variety || parsed.sort) ? raw.varietyName || parsed.variety || parsed.sort : '',
    stage,
    status,
    statusLabel,
    sterilityStatus,
    problemType,
    riskLevel,
    activeProblemQuantity,
    healthyQuantity,
    sourceQuantity,
    propagationQuantity,
    originType,
    parentCardId,
    parentCode,
    sourceEventId,
    generation,
    propagatedAt,
    propagationMethod,
    stageChangedAt,
    cancelledAt: raw.cancelledAt || '',
    currentQuantity,
    initialQuantity,
    totalQuantityLabel: formatQuantityDisplay(currentQuantity, initialQuantity),
    location,
    qrStatus,
    qrStatusLabel: formatQrStatus(qrStatus),
    daysInStage: getDaysInCurrentStage(stageChangedAt || raw.createdAt || report.createdAt),
    createdAt: raw.createdAt || report.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt || report.createdAt,
    snapshotAt,
    reportId: report.reportId,
    employeeName,
    employeeKey,
    events: eventList,
    photoFiles: uniqueStrings([...(raw.photoFiles || []), ...(raw.photos || [])]),
    searchText: [cardId, code, deviceId, ...titleParts, stage, status, statusLabel, location, originType, parentCode, propagationMethod].join(' ').toLowerCase()
  };
}

function formatBatchStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return ({
    active: 'Без отклонений',
    partial: 'Частично реализована',
    problem: 'Проблема',
    quarantine: 'Карантин',
    sold: 'Реализована',
    archived: 'Архивная',
    cancelled: 'Отменена',
    canceled: 'Отменена',
    completed: 'Завершена',
    inactive: 'Неактивна'
  })[value] || String(status || '').trim() || 'Не указан';
}

function formatQrStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return ({
    none: 'Не создан',
    pending_print: 'Ожидает печати',
    printed: 'Напечатан'
  })[value] || String(status || '').trim() || 'Не создан';
}

function formatQuantityDisplay(currentQuantity, totalQuantity) {
  const current = Number(currentQuantity) || 0;
  const total = Number(totalQuantity) || 0;
  if (total > 0 && current !== total && current <= total) return `${current} из ${total} шт.`;
  return `${current} шт.`;
}

function getDaysInCurrentStage(stageStartDate) {
  const start = toDateOnlyTime(stageStartDate);
  if (!start) return 0;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(Math.floor((today - start) / 86400000) + 1, 1);
}

function toDateOnlyTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function isVisiblePlantPart(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'отсутствует';
}

function buildBatchKey(deviceId, cardId, reportId) {
  const source = deviceId || `report:${String(reportId || 'unknown-report').trim()}`;
  // The key is placed in the URL as batchId, so it must not contain control characters.
  return `${source}::${String(cardId || '').trim()}`.toLowerCase();
}

function normalizeEvent(event, report, cardContext = {}) {
  const photos = uniqueStrings([...(event.photoFiles || []), ...(event.photos || []), ...(event.photoPaths || [])]);
  const extraFields = event.extraFields && typeof event.extraFields === 'object' ? event.extraFields : {};
  const type = String(event.type || '');
  const category = getEventCategory(event, photos.length > 0);
  const details = buildEventDetails(event, category, cardContext);
  const rawCreatedBy = firstValue([event.createdBy, event.author, event.user, event.userName]);
  const reportUser = report && report.user ? report.user : {};
  const reportUserName = firstValue([reportUser.displayName, [reportUser.firstName, reportUser.lastName].filter(Boolean).join(' ')]);
  const createdBy = isUnknownAuthor(rawCreatedBy) ? reportUserName : rawCreatedBy || reportUserName;
  return {
    eventId: String(event.eventId || `${report && report.reportId}-${event.createdAt || event.date || event.type}`),
    title: String(event.title || event.type || 'Событие'),
    type,
    typeLabel: formatEventType(type, event.title),
    category,
    createdAt: event.createdAt || event.date || event.timestamp || '',
    createdBy,
    count: event.currentQuantity ?? event.count ?? event.quantity ?? '',
    previousQuantity: event.previousQuantity ?? '',
    currentQuantity: event.currentQuantity ?? '',
    quantity: event.quantity ?? event.count ?? '',
    propagationMethod: event.propagationMethod || extraFields.propagationMethod || '',
    childCardId: event.childCardId || extraFields.childCardId || '',
    childCode: event.childCode || extraFields.childCode || '',
    parentCardId: event.parentCardId || extraFields.parentCardId || '',
    parentCode: event.parentCode || extraFields.parentCode || '',
    sourceEventId: event.sourceEventId || extraFields.sourceEventId || '',
    generation: event.generation ?? extraFields.generation ?? '',
    diseaseName: event.diseaseName || extraFields.diseaseName || '',
    pestName: event.pestName || extraFields.pestName || '',
    diseaseSeverity: event.diseaseSeverity || extraFields.diseaseSeverity || '',
    affectedQuantity: event.affectedQuantity ?? extraFields.affectedQuantity ?? '',
    recoveredQuantity: event.recoveredQuantity ?? extraFields.recoveredQuantity ?? '',
    comment: event.comment || event.message || '',
    details,
    extraFields,
    photos
  };
}

function getEventCategory(event = {}, hasPhotos = false) {
  const type = normalizeEventType(event);
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease'].includes(type)) return 'problems';
  if (['movement', 'stagechange', 'statuschange'].includes(type)) return 'movement';
  if (['introloss', 'loss', 'death', 'discard'].includes(type)) return 'losses';
  if (type === 'sale') return 'sales';
  if (type === 'propagation' || type === 'clonedfromparent') return 'propagation';
  if (type === 'transplant') return 'transplant';
  if (type === 'photo' || type === 'photos' || (hasPhotos && !type)) return 'photo';
  return 'other';
}

function buildEventDetails(event, category, cardContext = {}) {
  const get = (key) => readEventField(event, key);
  const getCard = (key) => firstValue(cardContext && [cardContext[key]]);
  const type = normalizeEventType(event);
  const items = [];
  const push = (label, value) => {
    const text = formatValue(value);
    if (text && !items.some((item) => item.label === label && item.value === text)) items.push({ label, value: text });
  };

  if (type === 'batchcreated') {
    const firstVisibleQuantity = (...values) => values.find((value) => formatValue(value)) || '';
    const createdQuantity = firstVisibleQuantity(get('quantity'), get('count'), get('currentQuantity'), getCard('quantity'), getCard('currentQuantity'), getCard('initialQuantity'));
    push('Стадия', get('stage') || getCard('stage'));
    push('Количество', withUnits(createdQuantity));
    const qrStatus = get('qrStatus') || getCard('qrStatus');
    if (qrStatus) push('QR', formatQrStatus(qrStatus));
  } else if (type === 'qrgenerated') {
    push('Код', get('code'));
    if (get('qrStatus')) push('QR', formatQrStatus(get('qrStatus')));
  } else if (type === 'rooting') {
    push('Количество', formatCountWithTotal(get('count') || get('quantity') || get('rootedCount') || get('transplantCount'), get('totalQuantity') || get('cardQuantity') || getCard('quantity') || getCard('currentQuantity') || getCard('initialQuantity')));
    push('Процент укоренения', get('rootingPercent') !== '' ? `${get('rootingPercent')}%` : '');
  } else if (type === 'plantingobservation') {
    push('Приживаемость', get('survivalRate'));
    push('Уровень стресса', get('stressLevel'));
    push('Тургор', get('turgor'));
    push('Комментарий', get('comment'));
  } else if (type === 'adaptationstress') {
    push('Уровень стресса', get('stressLevel'));
    push('Стабильность', get('stability'));
    push('Тургор', get('turgor'));
    push('Комментарий', get('comment'));
    push('Температура', get('environmentTemperature'));
    push('Влажность воздуха', get('environmentAirHumidity') || get('environmentHumidity'));
    push('Влажность субстрата', get('substrateHumidity'));
    push('Освещение', get('environmentLight'));
    push('Проветривание', get('ventilation'));
  } else if (type === 'hardeningobservation') {
    push('Уровень стресса', get('stressLevel'));
    push('Тургор', get('turgor'));
    push('Готовность к высадке', get('readinessForPlanting'));
    push('Комментарий', get('comment'));
  } else if (category === 'losses') {
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
    push('Дочерняя партия', get('childCode') || get('childCardId'));
    push('Родительская партия', get('parentCode') || get('parentCardId'));
    push('Поколение', get('generation'));
    push('Добавлено', withUnits(get('count') || get('quantity')));
    push('Было', withUnits(get('previousQuantity')));
    push('Стало', withUnits(get('currentQuantity')));
    push('Способ размножения', get('propagationMethod'));
  } else if (category === 'problems') {
    push('Затронуто', withUnits(get('affectedQuantity')));
    push('Выздоровело', withUnits(get('recoveredQuantity')));
    push('Тип проблемы', get('problemType') || get('problem'));
    push('Риск', get('riskLevel') || get('risk'));
    push('Описание', get('problemDescription') || get('diseaseName') || get('pestName') || get('reason') || get('quarantineReason'));
  } else if (category === 'movement' || category === 'transplant') {
    push('Откуда', get('previousLocation'));
    push('Куда', get('nextLocation'));
  }

  [
    ['Укоренено', 'rootedCount', true], ['Процент укоренения', 'rootingPercent', false, '%'],
    ['Тип ухода', 'careType'], ['Препарат', 'productName'], ['Дозировка', 'dosage'], ['Способ внесения', 'applicationMethod'],
    ['Реакция растений', 'plantReaction'], ['Уровень стресса', 'stressLevel'], ['Тургор', 'turgor'], ['Стабильность', 'stability'],
    ['Температура', 'environmentTemperature'], ['Влажность воздуха', 'environmentAirHumidity'], ['Влажность субстрата', 'substrateHumidity'],
    ['Освещение', 'environmentLight'], ['Проветривание', 'ventilation'], ['Скорость роста', 'growthRate'], ['Состояние', 'conditionDescription'],
    ['Место высадки', 'plantingLocation'], ['Схема посадки', 'plantingScheme'], ['Площадь', 'plotArea'], ['Тип грунта', 'soilType'],
    ['Итог', 'completionResult'], ['Болезнь', 'diseaseName'], ['Вредитель', 'pestName'], ['Степень поражения', 'diseaseSeverity']
  ].forEach(([label, key, quantity, suffix]) => {
    const value = get(key);
    push(label, quantity ? withUnits(value) : suffix && value !== '' ? `${value}${suffix}` : value);
  });

  if (type === 'stagechange') {
    push('Из стадии', get('fromStage'));
    push('В стадию', get('toStage'));
  }

  push('Комментарий', get('comment'));

  return items;
}

function formatEventType(type, title = '') {
  const key = String(type || '').toLowerCase().replace(/[^a-zа-яё]/g, '');
  const labels = {
    batchcreated: 'Создание партии',
    stagechange: 'Изменение стадии',
    statuschange: 'Изменение статуса',
    movement: 'Перемещение',
    sale: 'Продажа',
    introloss: 'Потери',
    loss: 'Потери',
    death: 'Гибель',
    discard: 'Списание',
    propagation: 'Размножение',
    clonedfromparent: 'Создание клона',
    rooting: 'Укоренение',
    transplant: 'Пересадка',
    planting: 'Высадка',
    plantingobservation: 'Наблюдение',
    plantingcare: 'Уход',
    plantingcompletion: 'Завершение',
    greenhouseobservation: 'Наблюдение',
    greenhousecare: 'Уход',
    greenhousedisease: 'Болезнь',
    hardeningobservation: 'Наблюдение',
    hardeningcare: 'Уход',
    adaptationstress: 'Наблюдение',
    adaptationcare: 'Уход',
    contamination: 'Контаминация',
    quarantine: 'Карантин',
    quarantinereleased: 'Снятие с карантина',
    problem: 'Проблема',
    photo: 'Фото'
  };
  return labels[key] || String(title || type || 'Событие').trim();
}

function formatCountWithTotal(value, totalQuantity) {
  const text = formatValue(value);
  if (!text) return '';
  const total = formatValue(totalQuantity);
  return total ? `${text} из ${total} шт.` : `${text} шт.`;
}

function readEventField(event, key) {
  const extra = event && event.extraFields && typeof event.extraFields === 'object' ? event.extraFields : {};
  return firstValue([event && event[key], extra[key]]);
}

function normalizeEventType(event) {
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

function isUnknownAuthor(value) {
  return ['unknown', 'неизвестно', 'local-user'].includes(String(value || '').trim().toLowerCase());
}

function deduplicateEvents(events) {
  const seen = new Map();
  for (const event of events) {
    if (!seen.has(event.eventId)) seen.set(event.eventId, event);
  }
  return [...seen.values()];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()))];
}

function resolveSnapshotAt(raw, parsed, report, events) {
  const candidates = [
    raw && raw.updatedAt,
    raw && raw.createdAt,
    parsed && parsed.date,
    report && report.createdAt,
    ...events.map((event) => event && (event.createdAt || event.date || event.timestamp))
  ].map(eventTime);

  return candidates.reduce((latest, value) => Math.max(latest, value), 0);
}

function eventTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value) {
  const time = eventTime(value);
  return time ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(time)) : '—';
}

module.exports = { buildStagesPageModel, buildBatchCatalog, deduplicateEvents, STAGE_ORDER, STAGE_LABELS, formatDate };
