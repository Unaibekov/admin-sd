const {
  getLatestBatchSnapshots,
  buildUniqueEventIndex,
  getAttentionBatches,
  getProductionMetrics,
  getRecentPhotos,
  isUserInitiatedEvent
} = require('./dashboardModel');

function buildReportDashboardModel(report) {
  const sourceReports = report ? [report] : [];
  const batches = getLatestBatchSnapshots(sourceReports);
  const events = buildUniqueEventIndex(sourceReports, batches).sort((left, right) => right.timestamp - left.timestamp);
  const attentionBatches = getAttentionBatches(batches, events);
  const productionMetrics = getProductionMetrics(events);
  const eventPhotos = getRecentPhotos(events);
  const recentPhotos = mergeReportPhotos(report, batches, eventPhotos);
  const summary = report && report.summary ? report.summary : {};
  const employee = resolveEmployee(report);
  const importInfo = formatImportInfo(report && report.createdAt);

  return {
    reportId: report ? report.reportId : '',
    employee,
    importDate: importInfo.date,
    importTime: importInfo.time,
    topMetrics: [
      { key: 'cards', label: 'Карточек', note: 'В этом отчете', value: batches.length, tone: 'dark' },
      { key: 'events', label: 'Событий', note: 'В этом отчете', value: events.length, tone: 'accent' },
      { key: 'problems', label: 'Проблем', note: 'Требуют внимания', value: attentionBatches.length, tone: 'warning' },
      { key: 'losses', label: 'Потерь', note: 'Зафиксировано в отчете', value: productionMetrics.losses ? productionMetrics.losses.value : 0, tone: 'danger' },
      { key: 'sales', label: 'Продаж', note: 'Зафиксировано в отчете', value: productionMetrics.sales ? productionMetrics.sales.value : 0, tone: 'success' },
      { key: 'photos', label: 'Фото', note: 'Прикреплено к отчету', value: Number(summary.photosCount) || recentPhotos.length, tone: 'accent' }
    ],
    summary: {
      cardsCount: batches.length,
      eventsCount: events.length,
      photosCount: Number(summary.photosCount) || recentPhotos.length,
      problemsCount: attentionBatches.length
    },
    recentEvents: events.filter(isUserInitiatedEvent),
    attentionEvents: attentionBatches.map((batch) => ({
      ...(batch.latestProblemEvent || {
        type: 'problem',
        title: batch.latestProblemTitle || batch.reason,
        culture: batch.title,
        code: batch.code,
        stage: batch.stage,
        createdBy: batch.latestProblemAuthor || '',
        timestamp: batch.latestProblemAt,
        problem: batch.reason,
        risk: batch.risk,
        problemDescription: batch.problemDescription
      }),
      batchKey: batch.batchKey,
      cardId: batch.cardId
    })),
    batches,
    recentPhotos
  };
}

function resolveEmployee(report) {
  const user = report && report.user ? report.user : {};
  const name = String(user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Ильдар Унайбеков').trim();
  return {
    name,
    role: 'Агроном',
    department: 'Тепличный комплекс №1'
  };
}

function mergeReportPhotos(report, batches, eventPhotos) {
  const photos = new Map((eventPhotos || []).map((photo) => [photo.url, photo]));
  const getPhotoUrl = report && typeof report.getPhotoUrl === 'function' ? report.getPhotoUrl.bind(report) : () => '';

  for (const batch of batches) {
    for (const photoPath of batch.photoFiles || []) {
      const url = getPhotoUrl(photoPath);
      if (!url || photos.has(url)) continue;
      photos.set(url, {
        url,
        label: `${batch.code} · ${batch.title}`,
        code: batch.code,
        eventTitle: 'Фото партии',
        createdBy: '',
        timestamp: batch.snapshotAt || 0,
        dateLabel: formatImportDate(batch.updatedAt || batch.createdAt)
      });
    }
  }

  return [...photos.values()].sort((left, right) => right.timestamp - left.timestamp);
}

function formatImportInfo(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return { date: 'Не указано', time: '—' };
  return {
    date: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(date),
    time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(date)
  };
}

function formatImportDate(value) {
  const info = formatImportInfo(value);
  return `${info.date} · ${info.time}`;
}

module.exports = { buildReportDashboardModel, resolveEmployee, mergeReportPhotos };
