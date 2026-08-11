const { getLatestBatchSnapshots, buildUniqueEventIndex, getRecentPhotos } = require('./dashboardModel');
const { buildReportDashboardModel, resolveEmployee } = require('./reportDashboardModel');

const PAGE_SIZE = 12;

function buildPhotosPageModel(reports = [], query = {}, selectedReport = null) {
  const requestedPage = normalizePage(query.page);
  const scopedReportId = selectedReport && selectedReport.reportId ? String(selectedReport.reportId) : '';

  const allPhotos = scopedReportId
    ? buildReportDashboardModel(selectedReport).recentPhotos
    : buildGlobalPhotos(reports);

  const totalItems = allPhotos.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = totalItems ? (page - 1) * PAGE_SIZE : 0;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
  const photos = allPhotos.slice(startIndex, endIndex);

  return {
    pageTitle: scopedReportId ? 'Фотофиксации отчета' : 'Фотофиксации',
    title: scopedReportId ? 'Фотофиксации отчета' : 'Фотофиксации',
    description: scopedReportId
      ? 'Фотографии, прикрепленные к событиям и карточкам выбранного отчета.'
      : 'Все фотофиксации по событиям с разбивкой по страницам.',
    selectedReportId: scopedReportId,
    selectedReportEmployee: scopedReportId ? resolveEmployee(selectedReport).name : '',
    totalItems,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
    photos,
    hasPhotos: totalItems > 0,
    hasPagination: totalPages > 1,
    rangeLabel: totalItems ? `${startIndex + 1}–${endIndex} из ${totalItems}` : '0 из 0'
  };
}

function buildGlobalPhotos(reports = []) {
  const batches = getLatestBatchSnapshots(reports);
  const events = buildUniqueEventIndex(reports, batches).sort((left, right) => right.timestamp - left.timestamp);
  return getRecentPhotos(events);
}

function normalizePage(value) {
  const page = Number.parseInt(String(value || '1').trim(), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

module.exports = { buildPhotosPageModel, PAGE_SIZE };
