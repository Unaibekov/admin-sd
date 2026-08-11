const {
  getLatestBatchSnapshots,
  buildUniqueEventIndex,
  getAttentionBatches,
  buildAttentionEvents,
  getProductionMetrics,
  getRecentPhotos,
  isUserInitiatedEvent
} = require('./dashboardModel');
const { normalizeRole } = require('./roleLabel');

function buildReportDashboardModel(report) {
  const sourceReports = report ? [report] : [];
  const batches = getLatestBatchSnapshots(sourceReports);
  const events = buildUniqueEventIndex(sourceReports, batches).sort((left, right) => right.timestamp - left.timestamp);
  const attentionBatches = getAttentionBatches(batches, events);
  const productionMetrics = getProductionMetrics(events);
  const eventPhotos = getRecentPhotos(events);
  const recentPhotos = mergeReportPhotos(report, batches, eventPhotos);
  const summary = report && report.summary ? report.summary : {};
  const reportId = report ? report.reportId : '';
  const employee = resolveEmployee(report);
  const importInfo = formatImportInfo(report && report.createdAt);
  const lossesCount = productionMetrics.losses ? productionMetrics.losses.value : 0;
  const salesCount = productionMetrics.sales ? productionMetrics.sales.value : 0;
  const photosCount = readCount(summary.photosCount, recentPhotos.length);

  return {
    reportId,
    employee,
    importDate: importInfo.date,
    importTime: importInfo.time,
    topMetrics: [
      { key: 'cards', label: 'Карточек', note: 'В этом отчете', value: batches.length, tone: 'dark' },
      { key: 'events', label: 'Событий', note: 'В этом отчете', value: events.length, tone: 'accent' },
      { key: 'problems', label: 'Проблем', note: 'Требуют внимания', value: attentionBatches.length, tone: 'warning' },
      { key: 'losses', label: 'Потерь', note: 'Зафиксировано в отчете', value: lossesCount, tone: 'danger' },
      { key: 'sales', label: 'Продаж', note: 'Зафиксировано в отчете', value: salesCount, tone: 'success' },
      { key: 'photos', label: 'Фото', note: 'Прикреплено к отчету', value: photosCount, tone: 'accent' }
    ],
    summary: {
      cardsCount: batches.length,
      eventsCount: events.length,
      photosCount,
      problemsCount: attentionBatches.length
    },
    recentEvents: events.filter(isUserInitiatedEvent),
    attentionEvents: buildAttentionEvents(attentionBatches),
    batches,
    recentPhotos
  };
}

function resolveEmployee(report) {
  const user = report && report.user ? report.user : {};
  const displayName = String(user.displayName || '').trim();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const author = String(report && report.author || '').trim();
  const userName = String(report && report.userName || '').trim();
  const name = String(
    displayName
      || fullName
      || author
      || userName
      || 'Неизвестно'
  ).trim();

  return {
    name,
    role: normalizeRole(user.role || ''),
    department: ''
  };
}

function mergeReportPhotos(report, batches, eventPhotos) {
  const photos = new Map((eventPhotos || []).map((photo) => [photo.url, photo]));
  const getPhotoUrl = report && typeof report.getPhotoUrl === 'function' ? report.getPhotoUrl.bind(report) : () => '';
  const employeeName = resolveEmployee(report).name;
  const reportId = report && report.reportId ? String(report.reportId) : '';

  for (const batch of batches) {
    for (const photoPath of batch.photoFiles || []) {
      const url = getPhotoUrl(photoPath);
      if (!url || photos.has(url)) continue;
      const journalUrl = buildBatchPhotoJournalUrl(batch.batchKey, reportId);
      photos.set(url, {
        key: `${batch.batchKey}|${photoPath}`,
        url,
        photoUrls: [url],
        photoCount: 1,
        extraPhotoCount: 0,
        label: `${batch.code} · ${batch.title}`,
        code: batch.code,
        title: batch.title,
        eventTitle: 'Фото партии',
        eventLabel: 'Фото партии',
        createdBy: employeeName,
        timestamp: batch.snapshotAt || 0,
        dateLabel: formatImportDate(batch.updatedAt || batch.createdAt),
        journalUrl,
        modal: {
          title: batch.title,
          code: batch.code,
          eventLabel: 'Фото партии',
          dateLabel: formatImportDate(batch.updatedAt || batch.createdAt),
          employeeLabel: employeeName,
          comment: '',
          journalUrl,
          details: [
            { label: 'Код партии', value: batch.code },
            { label: 'Стадия', value: batch.stage || 'Без стадии' }
          ],
          photos: [{ url, alt: `${batch.title} · ${batch.code}` }]
        }
      });
    }
  }

  return [...photos.values()].sort((left, right) => (left.priority || 99) - (right.priority || 99) || right.timestamp - left.timestamp);
}

function buildBatchPhotoJournalUrl(batchKey, reportId) {
  if (!batchKey) return '';
  const params = new URLSearchParams();
  if (reportId) params.set('reportId', reportId);
  params.set('batchId', batchKey);
  const query = params.toString();
  return query ? `/stages?${query}#passport` : '/stages#passport';
}

function formatImportInfo(value) {
  if (!value) return { date: 'Не указано', time: '—' };
  const date = new Date(value);
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

function readCount(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

module.exports = { buildReportDashboardModel, resolveEmployee, mergeReportPhotos };
