const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

const STAGE_LABELS = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage]));
const STAGE_ALIASES = {
  introduction: STAGE_ORDER[0],
  initiation: STAGE_ORDER[0],
  'introduction to culture': STAGE_ORDER[0],
  cloning: STAGE_ORDER[1],
  propagation: STAGE_ORDER[1],
  adaptation: STAGE_ORDER[2],
  acclimatization: STAGE_ORDER[2],
  greenhouse: STAGE_ORDER[3],
  hardening: STAGE_ORDER[4],
  planting: STAGE_ORDER[5],
  transplanting: STAGE_ORDER[5]
};
const STAGE_KEYS = new Map([
  ...STAGE_ORDER.map((stage) => [normalizeText(stage), stage]),
  ...Object.entries(STAGE_ALIASES).map(([alias, stage]) => [normalizeText(alias), stage])
]);

function canonicalizeStage(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return STAGE_KEYS.get(normalizeText(text)) || text;
}

function disambiguateEmployeeOptions(employees = []) {
  const duplicateCounts = new Map();

  for (const employee of employees) {
    const labelKey = normalizeText(employee && employee.label);
    if (!labelKey) continue;
    duplicateCounts.set(labelKey, (duplicateCounts.get(labelKey) || 0) + 1);
  }

  return employees.map((employee) => {
    const label = String(employee && employee.label || '').trim();
    const key = String(employee && employee.key || '').trim();
    const labelKey = normalizeText(label);

    if (!label || !key || (duplicateCounts.get(labelKey) || 0) < 2) {
      return employee;
    }

    return {
      ...employee,
      label: `${label} (${key})`
    };
  });
}

function buildBatchCatalog(reports) {
  const byKey = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    const parsedCards = Array.isArray(report && report.cards) ? report.cards : [];
    const rawCards = Array.isArray(report && report.raw && report.raw.cards)
      ? report.raw.cards
      : parsedCards;
    Array.from({ length: Math.max(rawCards.length, parsedCards.length) }, (_, index) => {
      const rawCard = rawCards[index] || {};
      const parsedCard = parsedCards[index] || {};
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
  const cultureName = firstVisiblePlantValue(
    raw.cultureName,
    raw.culture,
    raw.crop,
    raw.plant,
    parsed.cultureName,
    parsed.culture,
    parsed.crop,
    parsed.plant
  );
  const speciesName = firstVisiblePlantValue(
    raw.speciesName,
    raw.sort,
    raw.grade,
    parsed.speciesName,
    parsed.sort,
    parsed.grade
  );
  const varietyName = firstVisiblePlantValue(
    raw.varietyName,
    raw.variety,
    raw.cultivar,
    parsed.varietyName,
    parsed.variety,
    parsed.cultivar
  );
  const titleParts = [cultureName, speciesName, varietyName].filter(isVisiblePlantPart);
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const parsedEvents = Array.isArray(parsed.events) ? parsed.events : [];
  const events = Array.from({ length: Math.max(rawEvents.length, parsedEvents.length) }, (_, eventIndex) => mergeSnapshotEntity(
    parsedEvents[eventIndex] || {},
    rawEvents[eventIndex] || {}
  ));
  const snapshotAt = resolveSnapshotAt(raw, parsed, report, events);
  const currentQuantity = firstDefinedValue(
    raw.currentQuantity,
    raw.currentCount,
    raw.remainingCount,
    parsed.currentQuantity,
    parsed.currentCount,
    raw.quantity,
    parsed.quantity,
    parsed.initialQuantity,
    parsed.initialCount
  );
  const initialQuantity = firstDefinedValue(
    raw.initialQuantity,
    raw.initialCount,
    parsed.initialQuantity,
    raw.quantity,
    parsed.quantity,
    parsed.initialCount
  );
  const stage = canonicalizeStage(raw.stage || parsed.stage) || 'Без стадии';
  const status = String(raw.batchStatus || raw.status || parsed.status || 'Не указан').trim();
  const sterilityStatus = firstValue([raw.sterilityStatus, parsed.sterilityStatus]);
  const location = firstDefinedValue(
    raw.locationDescription,
    raw.location,
    raw.place,
    raw.position,
    parsed.locationDescription,
    parsed.location,
    parsed.place,
    parsed.position
  ) || '';
  const rawExtraFields = raw.extraFields && typeof raw.extraFields === 'object' ? raw.extraFields : {};
  const parsedExtraFields = parsed.extraFields && typeof parsed.extraFields === 'object' ? parsed.extraFields : {};
  const problemType = firstValue([raw.problemType, raw.problem, rawExtraFields.problemType, rawExtraFields.problem, parsed.problemType, parsed.problem, parsedExtraFields.problemType, parsedExtraFields.problem]);
  const riskLevel = firstValue([raw.riskLevel, raw.risk, rawExtraFields.riskLevel, rawExtraFields.risk, parsed.riskLevel, parsed.risk, parsedExtraFields.riskLevel, parsedExtraFields.risk]);
  const problemDescription = firstValue([
    raw.problemDescription,
    rawExtraFields.problemDescription,
    raw.diseaseName,
    raw.pestName,
    rawExtraFields.diseaseName,
    rawExtraFields.pestName,
    rawExtraFields.quarantineReason,
    parsed.problemDescription,
    parsedExtraFields.problemDescription,
    parsed.diseaseName,
    parsed.pestName,
    parsedExtraFields.diseaseName,
    parsedExtraFields.pestName,
    parsedExtraFields.quarantineReason
  ]);
  const activeProblemQuantity = firstDefinedValue(raw.activeProblemQuantity, parsed.activeProblemQuantity, '');
  const healthyQuantity = firstDefinedValue(raw.healthyQuantity, parsed.healthyQuantity, '');
  const healthStatus = firstDefinedValue(raw.healthStatus, parsed.healthStatus, '');
  const isolationStatus = firstDefinedValue(raw.isolationStatus, parsed.isolationStatus, '');
  const unisolatedProblemQuantity = firstDefinedValue(raw.unisolatedProblemQuantity, parsed.unisolatedProblemQuantity, '');
  const sourceQuantity = firstDefinedValue(raw.sourceQuantity, parsed.sourceQuantity, '');
  const propagationQuantity = firstDefinedValue(raw.propagationQuantity, parsed.propagationQuantity, '');
  const originType = raw.originType || parsed.originType || '';
  const parentCardId = raw.parentCardId || parsed.parentCardId || '';
  const parentCode = raw.parentCode || parsed.parentCode || '';
  const sourceEventId = raw.sourceEventId || parsed.sourceEventId || '';
  const sourceProblemEventId = raw.sourceProblemEventId || parsed.sourceProblemEventId || '';
  const childCardId = raw.childCardId || parsed.childCardId || '';
  const childCode = raw.childCode || parsed.childCode || '';
  const generation = firstDefinedValue(raw.generation, parsed.generation, '');
  const propagatedAt = raw.propagatedAt || parsed.propagatedAt || '';
  const propagationMethod = raw.propagationMethod || parsed.propagationMethod || '';
  const stageChangedAt = raw.stageChangedAt || parsed.stageChangedAt || '';
  const code = String(raw.code || parsed.code || `card-${index + 1}`);
  const cardId = String(raw.cardId || parsed.cardId || code);
  const qrStatus = raw.qrStatus || parsed.qrStatus || (raw.qrPrinted || parsed.qrPrinted ? 'printed' : code ? 'pending_print' : 'none');
  const deviceId = String(report.deviceId || '').trim();
  const reportUser = report && report.user ? report.user : {};
  const employeeDisplayName = String(reportUser.displayName || '').trim();
  const employeeFullName = [reportUser.firstName, reportUser.lastName].filter(Boolean).join(' ').trim();
  const reportAuthor = String(report && report.author || '').trim();
  const reportUserName = String(report && report.userName || '').trim();
  const employeeName = employeeDisplayName || employeeFullName || reportAuthor || reportUserName || 'Неизвестно';
  const employeeKey = normalizeText(reportUser.userId || employeeDisplayName || employeeFullName || reportAuthor || reportUserName || employeeName);
  const effectiveStage = canonicalizeStage(firstValue([raw.stage, parsed.stage])) || stage;
  const effectiveStatus = firstValue([raw.batchStatus, raw.status, parsed.batchStatus, parsed.status]) || status;
  const effectiveStatusLabel = formatBatchStatus(effectiveStatus);
  const effectiveOriginType = firstValue([raw.originType, parsed.originType]) || originType;
  const effectiveParentCardId = firstValue([raw.parentCardId, parsed.parentCardId]) || parentCardId;
  const effectiveParentCode = firstValue([raw.parentCode, parsed.parentCode]) || parentCode;
  const effectiveSourceEventId = firstValue([raw.sourceEventId, parsed.sourceEventId]) || sourceEventId;
  const effectivePropagatedAt = firstValue([raw.propagatedAt, parsed.propagatedAt]) || propagatedAt;
  const effectivePropagationMethod = firstValue([raw.propagationMethod, parsed.propagationMethod]) || propagationMethod;
  const effectiveStageChangedAt = firstValue([raw.stageChangedAt, parsed.stageChangedAt]) || stageChangedAt;
  const effectiveQrStatus = firstValue([raw.qrStatus, parsed.qrStatus]) || qrStatus;
  const effectiveCancelledAt = raw.cancelledAt || parsed.cancelledAt || '';
  const effectiveCreatedAt = raw.createdAt || parsed.createdAt || report.createdAt;
  const effectiveUpdatedAt = raw.updatedAt || parsed.updatedAt || raw.createdAt || parsed.createdAt || report.createdAt;
  const effectiveDaysInStage = getDaysInCurrentStage(stageChangedAt || raw.createdAt || parsed.createdAt || report.createdAt);
  const batchKey = buildBatchKey(deviceId, cardId, report.reportId);
  const healthStatusLabel = formatHealthStatus(healthStatus);
  const isolationStatusLabel = formatIsolationStatus(isolationStatus);
  const originLabel = formatOriginType(effectiveOriginType);
  const eventContext = {
    ...parsed,
    ...raw,
    stage: effectiveStage,
    quantity: raw.quantity ?? parsed.quantity ?? initialQuantity ?? currentQuantity,
    currentQuantity,
    initialQuantity,
    qrStatus: effectiveQrStatus
  };
  const eventList = events.map((event) => normalizeEvent(event, report, eventContext));

  return {
    cardId,
    batchKey,
    deviceId,
    code,
    title: titleParts.length ? titleParts.join(' · ') : code,
    culture: cultureName,
    species: speciesName,
    variety: varietyName,
    stage: effectiveStage,
    status: effectiveStatus,
    statusLabel: effectiveStatusLabel,
    sterilityStatus,
    problemType,
    riskLevel,
    problemDescription,
    activeProblemQuantity,
    healthyQuantity,
    healthStatus,
    healthStatusLabel,
    isolationStatus,
    isolationStatusLabel,
    unisolatedProblemQuantity,
    sourceQuantity,
    propagationQuantity,
    originType: effectiveOriginType,
    originLabel,
    parentCardId: effectiveParentCardId,
    parentCode: effectiveParentCode,
    sourceEventId: effectiveSourceEventId,
    sourceProblemEventId,
    childCardId,
    childCode,
    generation,
    propagatedAt: effectivePropagatedAt,
    propagationMethod: effectivePropagationMethod,
    stageChangedAt: effectiveStageChangedAt,
    cancelledAt: effectiveCancelledAt,
    currentQuantity,
    initialQuantity,
    totalQuantityLabel: formatQuantityDisplay(currentQuantity, initialQuantity),
    location,
    qrStatus: effectiveQrStatus,
    qrStatusLabel: formatQrStatus(effectiveQrStatus),
    daysInStage: effectiveDaysInStage,
    createdAt: effectiveCreatedAt,
    updatedAt: effectiveUpdatedAt,
    snapshotAt,
    reportId: report.reportId,
    employeeName,
    employeeKey,
    events: eventList,
    photoFiles: collectPhotoAliases([
      raw.photoFiles,
      raw.photos,
      raw.photoPath,
      raw.photoPaths,
      raw.photoUri,
      raw.photoUris,
      raw.startPhotoUri,
      raw.startPhotoUris,
      parsed.photoFiles,
      parsed.photos,
      parsed.photoPath,
      parsed.photoPaths,
      parsed.photoUri,
      parsed.photoUris,
      parsed.startPhotoUri,
      parsed.startPhotoUris
    ]),
    searchText: [cardId, code, deviceId, employeeName, ...titleParts, effectiveStage, raw.stage, parsed.stage, effectiveStatus, effectiveStatusLabel, location, effectiveOriginType, effectiveParentCode, childCode, healthStatus, isolationStatus, effectivePropagationMethod].join(' ').toLowerCase()
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

function formatHealthStatus(status) {
  const value = normalizeText(status);
  return ({
    infected: 'Проблема активна',
    problem: 'Проблема активна',
    unhealthy: 'Проблема активна',
    healthy: 'Здоровая',
    resolved: 'Проблема решена',
    recovered: 'Проблема решена'
  })[value] || String(status || '').trim();
}

function formatIsolationStatus(status) {
  const value = normalizeText(status);
  return ({
    isolated: 'Изолирована',
    quarantine: 'Изолирована',
    released: 'Изоляция снята',
    none: 'Без изоляции'
  })[value] || String(status || '').trim();
}

function formatOriginType(originType) {
  const value = normalizeText(originType);
  return ({
    cloned: 'Клон',
    problemisolation: 'Изолированная партия'
  })[value] || String(originType || '').trim();
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

function firstVisiblePlantValue(...values) {
  return values.find(isVisiblePlantPart) || '';
}

function buildBatchKey(deviceId, cardId, reportId) {
  const source = deviceId || `report:${String(reportId || 'unknown-report').trim()}`;
  // The key is placed in the URL as batchId, so it must not contain control characters.
  return `${source}::${String(cardId || '').trim()}`.toLowerCase();
}

function normalizeEvent(event, report, cardContext = {}) {
  const photos = collectPhotoAliases([
    event.photoFiles,
    event.photos,
    event.photoPath,
    event.photoPaths,
    event.photoUri,
    event.photoUris
  ]);
  const extraFields = event.extraFields && typeof event.extraFields === 'object' ? event.extraFields : {};
  const type = String(event.type || '');
  const category = getEventCategory(event, photos.length > 0);
  const details = buildEventDetails(event, category, cardContext);
  const rawCreatedBy = firstValue([event.createdBy, event.author, event.user, event.userName]);
  const reportUser = report && report.user ? report.user : {};
  const reportUserId = firstValue([reportUser.userId]);
  const reportUserName = firstValue([reportUser.displayName, [reportUser.firstName, reportUser.lastName].filter(Boolean).join(' '), report && report.author, report && report.userName]);
  const createdBy = isUnknownAuthor(rawCreatedBy) || (reportUserId && normalizeText(rawCreatedBy) === normalizeText(reportUserId))
    ? reportUserName
    : rawCreatedBy || reportUserName;
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
    problem: event.problem || extraFields.problem || '',
    problemType: event.problemType || extraFields.problemType || '',
    risk: event.risk || extraFields.risk || '',
    riskLevel: event.riskLevel || extraFields.riskLevel || '',
    problemDescription: event.problemDescription || extraFields.problemDescription || '',
    propagationMethod: event.propagationMethod || extraFields.propagationMethod || '',
    childCardId: event.childCardId || extraFields.childCardId || '',
    childCode: event.childCode || extraFields.childCode || '',
    parentCardId: event.parentCardId || extraFields.parentCardId || '',
    parentCode: event.parentCode || extraFields.parentCode || '',
    sourceEventId: event.sourceEventId || extraFields.sourceEventId || '',
    sourceProblemEventId: event.sourceProblemEventId || extraFields.sourceProblemEventId || '',
    generation: event.generation ?? extraFields.generation ?? '',
    healthStatus: event.healthStatus || extraFields.healthStatus || '',
    isolationStatus: event.isolationStatus || extraFields.isolationStatus || '',
    activeProblemQuantity: event.activeProblemQuantity ?? extraFields.activeProblemQuantity ?? '',
    unisolatedProblemQuantity: event.unisolatedProblemQuantity ?? extraFields.unisolatedProblemQuantity ?? '',
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
  if (hasProblemSignals(event)) return 'problems';
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease', 'problemisolation', 'isolatedfromparent', 'problemrecovery'].includes(type)) return 'problems';
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
  } else if (type === 'problemisolation' || type === 'isolatedfromparent') {
    push('Изолированная партия', get('childCode') || get('childCardId'));
    push('Родительская партия', get('parentCode') || get('parentCardId'));
    push('Изолировано', withUnits(get('count') || get('quantity') || get('activeProblemQuantity')));
    push('С активной проблемой', withUnits(get('activeProblemQuantity')));
    push('Без изоляции', withUnits(get('unisolatedProblemQuantity')));
    push('Состояние здоровья', formatHealthStatus(get('healthStatus')));
    push('Статус изоляции', formatIsolationStatus(get('isolationStatus')));
    push('Источник проблемы', get('sourceProblemEventId'));
  } else if (type === 'problemrecovery') {
    push('Выздоровело', withUnits(get('recoveredQuantity') || get('quantity')));
    push('С активной проблемой', withUnits(get('activeProblemQuantity')));
    push('Без изоляции', withUnits(get('unisolatedProblemQuantity')));
    push('Состояние здоровья', formatHealthStatus(get('healthStatus')));
    push('Статус изоляции', formatIsolationStatus(get('isolationStatus')));
    push('Стало', withUnits(get('currentQuantity')));
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
    problemisolation: 'Изоляция проблемных растений',
    isolatedfromparent: 'Создание изолированной партии',
    problemrecovery: 'Проблема решена',
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

function hasProblemSignals(event) {
  const type = normalizeEventType(event);
  if (['problem', 'contamination', 'quarantine', 'quarantinereleased', 'greenhousedisease'].includes(type)) return true;

  return Boolean(
    readEventField(event, 'problemType')
    || readEventField(event, 'problem')
    || readEventField(event, 'riskLevel')
    || readEventField(event, 'risk')
    || readEventField(event, 'problemDescription')
    || readEventField(event, 'diseaseName')
    || readEventField(event, 'pestName')
    || readEventField(event, 'quarantineReason')
  );
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

function firstDefinedValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (!value.trim()) continue;
      return value.trim();
    }
    return value;
  }
  return undefined;
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

function collectPhotoAliases(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) {
      result.push(...collectPhotoAliases(value));
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      result.push(value.trim());
      continue;
    }
    if (value && typeof value === 'object') {
      result.push(...collectPhotoAliases([
        value.photoPath,
        value.photoUri,
        value.path,
        value.uri,
        value.photoFiles,
        value.photoPaths,
        value.photoUris
      ]));
    }
  }
  return uniqueStrings(result);
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

module.exports = { buildStagesPageModel, buildBatchCatalog, deduplicateEvents, STAGE_ORDER, STAGE_LABELS, formatDate };

function mergeSnapshotEntity(parsed, raw) {
  const merged = {
    ...(parsed && typeof parsed === 'object' ? parsed : {})
  };

  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (typeof value === 'string') {
      if (value.trim()) merged[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (hasMeaningfulValue(value)) merged[key] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      const nested = mergeSnapshotEntity(
        merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key]) ? merged[key] : {},
        value
      );
      if (Object.keys(nested).length) merged[key] = nested;
      continue;
    }
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  return merged;
}

function hasMeaningfulValue(value) {
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  return value !== undefined && value !== null;
}

const ALL_EMPLOYEES_LABEL = '\u0412\u0441\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438';
const ALL_BATCHES_LABEL = '\u0412\u0441\u0435 \u043f\u0430\u0440\u0442\u0438\u0438';
const ALL_STATUSES_LABEL = '\u0412\u0441\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u044b';
const STAGES_PAGE_TITLE = '\u041f\u0430\u0440\u0442\u0438\u0438';
const READABLE_DASH = '\u2014';
const STATUS_FILTER_DEFINITIONS = [
  { key: 'active', label: '\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0435' },
  { key: 'problem', label: '\u0421 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u043e\u0439' },
  { key: 'isolated', label: '\u0412 \u0438\u0437\u043e\u043b\u044f\u0446\u0438\u0438' },
  { key: 'quarantine', label: '\u041a\u0430\u0440\u0430\u043d\u0442\u0438\u043d' },
  { key: 'completed', label: '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0435' },
  { key: 'sold_archived', label: '\u041f\u0440\u043e\u0434\u0430\u043d\u043d\u044b\u0435 / \u0430\u0440\u0445\u0438\u0432\u043d\u044b\u0435' }
];

function buildStagesPageModel(reports = [], query = {}) {
  const cards = attachBatchRelations(buildBatchCatalog(reports)).map(enrichBatchState);
  const search = String(query.q || '').trim();
  const selectedReportId = String(query.reportId || '').trim();
  const requestedStage = String(query.stage || '').trim();
  const stage = normalizeText(requestedStage) === 'all'
    ? 'all'
    : canonicalizeStage(requestedStage) || 'all';
  const employeeOptions = buildEmployeeOptions(cards);
  const requestedEmployee = String(query.employee || '').trim();
  const normalizedRequestedEmployee = normalizeText(requestedEmployee);
  const fallbackEmployeeOption = employeeOptions.find((item) => item.key !== 'all') || employeeOptions[0] || { key: 'all' };
  const selectedEmployeeOption = employeeOptions.find((item) => normalizeText(item.key) === normalizedRequestedEmployee) || null;
  const employee = normalizedRequestedEmployee
    ? (selectedEmployeeOption || fallbackEmployeeOption).key
    : 'all';
  const requestedStatus = normalizeText(query.status || 'all') || 'all';
  const status = STATUS_FILTER_DEFINITIONS.some((item) => item.key === requestedStatus) || requestedStatus === 'all'
    ? requestedStatus
    : 'all';
  const cardsMatchingSearch = cards.filter((card) => !search || card.searchText.includes(search.toLowerCase()));
  const employeeScopedCards = cardsMatchingSearch.filter((card) => employee === 'all' || normalizeText(card.employeeKey) === normalizeText(employee));
  const stageScopedCards = cardsMatchingSearch.filter((card) => !stage || stage === 'all' || normalizeText(canonicalizeStage(card.stage)) === normalizeText(stage));
  const filteredCards = cards.filter((card) => {
    const matchesStage = !stage || stage === 'all' || normalizeText(canonicalizeStage(card.stage)) === normalizeText(stage);
    const matchesEmployee = employee === 'all' || normalizeText(card.employeeKey) === normalizeText(employee);
    const matchesSearch = !search || card.searchText.includes(search.toLowerCase());
    const matchesStatus = status === 'all' || matchesStatusFilter(card, status);
    return matchesStage && matchesEmployee && matchesSearch && matchesStatus;
  });
  const requestedBatchKey = normalizeText(query.batchId);
  const requestedCardId = String(query.cardId || '').trim();
  const selectedTab = ['passport', 'journal'].includes(normalizeText(query.tab))
    ? normalizeText(query.tab)
    : 'journal';
  const highlightedEventId = String(query.eventId || '').trim();
  const selectedCard = filteredCards.find((card) => normalizeText(card.batchKey) === requestedBatchKey)
    || (!requestedBatchKey && filteredCards.find((card) => card.cardId === requestedCardId))
    || null;

  return {
    pageTitle: STAGES_PAGE_TITLE,
    search,
    selectedReportId,
    selectedStage: stage || 'all',
    selectedEmployee: employee,
    selectedStatus: status,
    selectedCardId: selectedCard ? selectedCard.cardId : '',
    selectedBatchKey: selectedCard ? selectedCard.batchKey : '',
    selectedTab,
    highlightedEventId,
    cards: filteredCards,
    selectedCard,
    stages: buildStageOptions(employeeScopedCards, status),
    employees: buildEmployeeOptions(stageScopedCards, status),
    statuses: buildStatusOptions(employeeScopedCards, stage),
    hasActiveFilters: Boolean(search || stage !== 'all' || employee !== 'all' || status !== 'all')
  };
}

function attachBatchRelations(cards = []) {
  const items = Array.isArray(cards) ? cards.map((card) => ({ ...card })) : [];
  const byCardId = new Map(items.map((card) => [normalizeText(card.cardId), card]));
  const byCode = new Map(items.map((card) => [normalizeText(card.code), card]));

  items.forEach((card) => {
    const parent = byCardId.get(normalizeText(card.parentCardId)) || byCode.get(normalizeText(card.parentCode)) || null;
    card.parentBatch = parent
      ? { batchKey: parent.batchKey, code: parent.code, title: parent.title, stage: parent.stage }
      : null;
  });

  items.forEach((card) => {
    card.childBatches = items
      .filter((candidate) => candidate.batchKey !== card.batchKey
        && (normalizeText(candidate.parentCardId) === normalizeText(card.cardId)
          || (candidate.parentCode && normalizeText(candidate.parentCode) === normalizeText(card.code))))
      .map((candidate) => ({
        batchKey: candidate.batchKey,
        code: candidate.code,
        title: candidate.title,
        stage: candidate.stage,
        originType: candidate.originType,
        originLabel: candidate.originLabel,
        currentQuantity: candidate.currentQuantity,
        healthStatus: candidate.healthStatus,
        healthStatusLabel: candidate.healthStatusLabel,
        isolationStatus: candidate.isolationStatus,
        isolationStatusLabel: candidate.isolationStatusLabel
      }))
      .sort((left, right) => left.code.localeCompare(right.code, 'ru'));
  });

  return items;
}

function buildEmployeeOptions(cards, selectedStatus = 'all') {
  const employees = new Map();
  cards.forEach((card) => {
    if ((selectedStatus !== 'all' && !matchesStatusFilter(card, selectedStatus)) || !card.employeeKey || !card.employeeName) return;
    const employee = employees.get(card.employeeKey) || { key: card.employeeKey, label: card.employeeName, count: 0 };
    employee.count += 1;
    employees.set(card.employeeKey, employee);
  });

  return [
    {
      key: 'all',
      label: ALL_EMPLOYEES_LABEL,
      count: cards.filter((card) => selectedStatus === 'all' || matchesStatusFilter(card, selectedStatus)).length
    },
    ...disambiguateEmployeeOptions([...employees.values()]).sort((a, b) => a.label.localeCompare(b.label, 'ru') || a.key.localeCompare(b.key, 'ru'))
  ];
}

function buildStageOptions(cards = [], selectedStatus = 'all') {
  const scopedCards = Array.isArray(cards)
    ? cards.filter((card) => selectedStatus === 'all' || matchesStatusFilter(card, selectedStatus))
    : [];
  return [
    { key: 'all', label: ALL_BATCHES_LABEL, count: scopedCards.length },
    ...STAGE_ORDER.map((key) => ({
      key,
      label: STAGE_LABELS[key],
      count: scopedCards.filter((card) => normalizeText(canonicalizeStage(card.stage)) === normalizeText(key)).length
    }))
  ];
}

function buildStatusOptions(cards = [], selectedStage = 'all') {
  const scopedCards = Array.isArray(cards)
    ? cards.filter((card) => !selectedStage || selectedStage === 'all' || normalizeText(canonicalizeStage(card.stage)) === normalizeText(selectedStage))
    : [];
  return [
    { key: 'all', label: ALL_STATUSES_LABEL, count: scopedCards.length },
    ...STATUS_FILTER_DEFINITIONS.map((definition) => ({
      ...definition,
      count: scopedCards.filter((card) => matchesStatusFilter(card, definition.key)).length
    }))
  ];
}

function matchesStatusFilter(card = {}, filterKey = '') {
  const visualStatusKey = resolveVisualStatusKey(card);

  if (filterKey === 'active') return visualStatusKey === 'active';
  if (filterKey === 'problem') return visualStatusKey === 'problem';
  if (filterKey === 'isolated') return visualStatusKey === 'isolated';
  if (filterKey === 'quarantine') return visualStatusKey === 'quarantine';
  if (filterKey === 'completed') return visualStatusKey === 'completed';
  if (filterKey === 'sold_archived') return visualStatusKey === 'final';
  return true;
}

function enrichBatchState(card = {}) {
  const visualStatusKey = resolveVisualStatusKey(card);
  return {
    ...card,
    visualStatusKey,
    visualStatusLabel: resolveVisualStatusLabel(card, visualStatusKey),
    visualStatusTone: resolveVisualStatusTone(visualStatusKey)
  };
}

function resolveVisualStatusKey(card = {}) {
  const status = normalizeStatus(card.status);
  if (isIsolatedBatch(card)) return 'isolated';
  if (status === 'quarantine' && !isReleasedIsolationBatch(card)) return 'quarantine';
  if (hasActiveProblem(card)) return 'problem';
  if (status === 'completed') return 'completed';
  if (['sold', 'archived', 'cancelled', 'canceled'].includes(status)) return 'final';
  if (isWorkingStatus(status)) return 'active';
  return status || 'unknown';
}

function resolveVisualStatusLabel(card = {}, visualStatusKey = '') {
  if (visualStatusKey === 'isolated') return '\u0412 \u0438\u0437\u043e\u043b\u044f\u0446\u0438\u0438';
  if (visualStatusKey === 'problem') return '\u0421 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u043e\u0439';
  if (visualStatusKey === 'quarantine') return '\u041a\u0430\u0440\u0430\u043d\u0442\u0438\u043d';
  if (visualStatusKey === 'active') return '\u0410\u043a\u0442\u0438\u0432\u043d\u0430\u044f';
  return card.statusLabel || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
}

function resolveVisualStatusTone(visualStatusKey = '') {
  if (['problem', 'isolated', 'quarantine'].includes(visualStatusKey)) return 'alert';
  if (visualStatusKey === 'active') return 'ok';
  if (['completed', 'final', 'cancelled', 'unknown'].includes(visualStatusKey)) return 'muted';
  return 'muted';
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/[\s_-]+/g, '');
}

function isWorkingStatus(status) {
  return !['sold', 'archived', 'cancelled', 'canceled', 'completed', 'inactive'].includes(normalizeStatus(status));
}

function isIsolatedBatch(batch = {}) {
  return normalizeText(batch.originType) === 'problemisolation'
    && normalizeText(batch.isolationStatus) === 'isolated';
}

function isReleasedIsolationBatch(batch = {}) {
  return normalizeText(batch.originType) === 'problemisolation'
    && normalizeText(batch.isolationStatus) === 'released'
    && toPositiveNumber(batch.activeProblemQuantity) === 0;
}

function hasActiveProblem(batch = {}) {
  const activeProblemQuantity = toPositiveNumber(batch.activeProblemQuantity);
  if (activeProblemQuantity > 0) return true;
  if (hasExplicitZero(batch.activeProblemQuantity)) return false;

  const healthStatus = normalizeText(batch.healthStatus);
  const status = normalizeStatus(batch.status);
  const isolationStatus = normalizeText(batch.isolationStatus);

  if (healthStatus === 'resolved' || healthStatus === 'recovered' || isolationStatus === 'released') {
    return false;
  }

  return healthStatus === 'infected'
    || healthStatus === 'problem'
    || healthStatus === 'unhealthy'
    || status === 'problem'
    || (status === 'quarantine' && isolationStatus !== 'released');
}

function hasExplicitZero(value) {
  if (value === undefined || value === null || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatDate(value) {
  const time = eventTime(value);
  return time ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(time)) : READABLE_DASH;
}
