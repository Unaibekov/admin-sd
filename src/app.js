const express = require('express');
const multer = require('multer');
const path = require('path');
const { buildJournalModel } = require('./journalModel');
const {
  listReports,
  clearAllReports,
  getReport,
  processUploadedReport,
  safeReportId,
  reportFilePath
} = require('./reportStore');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.urlencoded({ extended: false }));
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));
  app.use('/storage', express.static(path.join(__dirname, '..', 'data')));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
  });

  app.get('/', async (req, res, next) => {
    try {
      const reports = await listReports();
      const detailedReports = await Promise.all(reports.map((report) => getReport(report.reportId)));
      const loadedReports = detailedReports.filter(Boolean);
      const latestReport = loadedReports.length ? loadedReports[0] : null;
      const selectedReportId = safeReportId(req.query.reportId || (latestReport && latestReport.reportId) || '');
      const selectedReport = loadedReports.find((report) => report.reportId === selectedReportId) || latestReport;
      const dashboard = buildDashboard(reports, selectedReport, loadedReports, req.query);
      const flashMessage = buildFlashMessage(req.query);

      res.render('index', {
        reports,
        dashboard,
        latestReport,
        pageTitle: 'Дашборд',
        showDashboardLink: dashboard.hasReports,
        flashMessage
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports', async (req, res, next) => {
    try {
      const reports = await listReports();
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = 4;
      const totalPages = Math.max(1, Math.ceil(reports.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const pageReports = reports.slice(startIndex, startIndex + pageSize);

      res.render('reports', {
        pageTitle: 'Отчеты',
        activePage: 'reports',
        showDashboardLink: true,
        reports,
        pageReports,
        pagination: {
          currentPage,
          totalPages,
          hasPrevious: currentPage > 1,
          hasNext: currentPage < totalPages
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/reports/clear', async (req, res, next) => {
    try {
      await clearAllReports();
      res.redirect(303, '/?cleared=1');
    } catch (error) {
      next(error);
    }
  });

  app.get('/upload', async (req, res, next) => {
    try {
      const reports = await listReports();
      res.render('upload', {
        pageTitle: 'Загрузка отчета',
        error: null,
        showDashboardLink: reports.length > 0
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/upload', upload.array('reportZip', 20), async (req, res, next) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        return res.status(400).render('upload', {
          pageTitle: 'Загрузка отчета',
          showDashboardLink: true,
          error: 'Перед отправкой выберите не меньше одного ZIP-архива.'
        });
      }

      const results = [];
      for (const file of files) {
        if (path.extname(file.originalname).toLowerCase() !== '.zip') {
          results.push({
            ok: false,
            error: 'Принимаются только ZIP-архивы.'
          });
          continue;
        }

        try {
          const reportId = await processUploadedReport(file.buffer, file.originalname);
          results.push({ ok: true, reportId });
        } catch (error) {
          results.push({
            ok: false,
            error: error && error.userMessage ? error.userMessage : 'Не удалось импортировать архив.'
          });
        }
      }

      const successCount = results.filter((result) => result.ok).length;
      const failedCount = results.length - successCount;
      const params = new URLSearchParams();
      params.set('uploaded', String(successCount));
      params.set('failed', String(failedCount));
      if (!successCount) {
        params.set('error', '1');
      }

      res.redirect(303, `/?${params.toString()}`);
    } catch (error) {
      const message = error && error.userMessage ? error.userMessage : 'Не удалось импортировать архив.';
      res.status(400).render('upload', {
        pageTitle: 'Загрузка отчета',
        showDashboardLink: true,
        error: message
      });
    }
  });

  app.get('/reports/:reportId', async (req, res, next) => {
    try {
      const reportId = safeReportId(req.params.reportId);
      const report = await getReport(reportId);
      if (!report) {
        return res.status(404).render('error', {
          pageTitle: 'Отчет не найден',
          message: 'Выбранный отчет не существует.'
        });
      }

      const filters = {
        q: String(req.query.q || '').trim(),
        date: String(req.query.date || '').trim(),
        author: String(req.query.author || '').trim(),
        stage: String(req.query.stage || '').trim(),
        culture: String(req.query.culture || '').trim(),
        status: String(req.query.status || '').trim(),
        hasProblems: String(req.query.hasProblems || '').trim(),
        hasPhotos: String(req.query.hasPhotos || '').trim()
      };

      const model = report.buildViewModel(filters);
      res.render('report', {
        pageTitle: `Отчет ${report.reportId}`,
        report: model,
        filters
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports/:reportId/raw', async (req, res, next) => {
    try {
      const reportId = safeReportId(req.params.reportId);
      const file = reportFilePath(reportId, 'report.json');
      res.download(file, `${reportId}-report.json`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports/:reportId/zip', async (req, res, next) => {
    try {
      const reportId = safeReportId(req.params.reportId);
      const file = reportFilePath(reportId, 'original.zip');
      res.download(file, `${reportId}.zip`);
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    res.status(404).render('error', {
      pageTitle: 'Не найдено',
      message: 'Запрошенная страница не найдена.'
    });
  });

  app.use((error, req, res, next) => {
    const status = error.statusCode || 500;
    const message = error.userMessage || error.message || 'Непредвиденная ошибка сервера.';
    res.status(status).render('error', {
      pageTitle: 'Ошибка',
      message
    });
  });

  return app;
}

function buildFlashMessage(query) {
  const parts = [];

  if (String(query.cleared || '') === '1') {
    parts.push('Отчеты очищены.');
  }

  const uploaded = Number(query.uploaded || 0);
  const failed = Number(query.failed || 0);
  if (uploaded > 0 || failed > 0) {
    parts.push(`Загружено отчетов: ${uploaded}.`);
    if (failed > 0) {
      parts.push(`Не удалось обработать: ${failed}.`);
    }
  }

  return parts.join(' ');
}

function buildDashboard(reports, selectedReport = null, reportModels = [], query = {}) {
  const dashboard = {
    reportsCount: reports.length,
    cardsCount: 0,
    eventsCount: 0,
    photosCount: 0,
    problemsCount: 0,
    activeCount: 0,
    soldCount: 0,
    quarantineCount: 0,
    partialCount: 0,
    archivedCount: 0,
    problemCount: 0,
    lossCount: 0
  };

  for (const report of reports) {
    const summary = report.summary || {};
    dashboard.cardsCount += Number(summary.cardsCount) || 0;
    dashboard.eventsCount += Number(summary.eventsCount) || 0;
    dashboard.photosCount += Number(summary.photosCount) || 0;
    dashboard.problemsCount += Number(summary.problemsCount) || 0;
    dashboard.activeCount += Number(summary.activeCount) || 0;
    dashboard.soldCount += Number(summary.soldCount) || 0;
    dashboard.quarantineCount += Number(summary.quarantineCount) || 0;
    dashboard.partialCount += Number(summary.partialCount) || 0;
    dashboard.archivedCount += Number(summary.archivedCount) || 0;
    dashboard.problemCount += Number(summary.problemCount) || 0;
    dashboard.lossCount += Number(summary.lossCount) || 0;
  }

  dashboard.hasReports = dashboard.reportsCount > 0;
  dashboard.hasCards = dashboard.cardsCount > 0;
  dashboard.recentReports = reports.slice(0, 5);
  dashboard.topMetrics = [
    { label: 'Партии', value: dashboard.cardsCount, tone: 'dark' },
    { label: 'Проблемы', value: dashboard.problemsCount, tone: 'warning' },
    { label: 'Карантин', value: dashboard.quarantineCount, tone: 'accent' },
    { label: 'Потери', value: dashboard.lossCount, tone: 'danger' },
    { label: 'Продано', value: dashboard.soldCount, tone: 'success' }
  ];

  const chartSourceReports = reportModels.length ? reportModels : selectedReport ? [selectedReport] : [];

  if (selectedReport) {
    const problemCards = collectProblemEntriesFromReports(reportModels.length ? reportModels : [selectedReport])
      .sort((left, right) => problemEntryTimestamp(right) - problemEntryTimestamp(left))
      .slice(0, 5);
    const cards = selectedReport.cards || [];
    const latestEvents = cards
      .flatMap((card) => card.events.map((event) => ({
        ...event,
        cardCode: card.code,
        cardCulture: [card.cultureName, card.speciesName, card.varietyName].filter(Boolean).join(' · ')
      })))
      .sort((left, right) => new Date(right.createdAt || right.date || 0).getTime() - new Date(left.createdAt || left.date || 0).getTime())
      .slice(0, 5);

    const photoItems = [];
    for (const card of cards) {
      for (const photo of card.photos) {
        photoItems.push({ photo, label: card.code, kind: 'card' });
      }
      for (const event of card.events) {
        for (const photo of event.photos) {
          photoItems.push({ photo, label: `${card.code} · ${event.title || event.type}`, kind: 'event' });
        }
      }
    }

    const journal = buildJournalModel(selectedReport, query);

    dashboard.latestReport = {
      reportId: selectedReport.reportId,
      displayCreatedAt: selectedReport.displayCreatedAt,
      author: selectedReport.user && selectedReport.user.displayName ? selectedReport.user.displayName : selectedReport.author,
      deviceId: selectedReport.deviceId,
      testLocation: selectedReport.testLocation,
      summary: selectedReport.summary,
      cardsCount: cards.length,
      problemCards,
      latestEvents,
      photoItems: photoItems.slice(0, 12),
      getPhotoUrl: selectedReport.getPhotoUrl.bind(selectedReport),
      journal
    };

    const chartCards = chartSourceReports.flatMap((report) => report.cards || []);

    dashboard.chartTabs = {
      stages: buildChartTabFromCards(chartCards, {
        title: 'Партии по стадиям',
        totalLabel: 'Всего',
        emptyLabel: 'Стадии'
      }, (card) => card.stage || 'Без стадии', [
        '#2f855a',
        '#3b82f6',
        '#f59e0b',
        '#8b5cf6',
        '#ef4444',
        '#14b8a6',
        '#64748b'
      ]),
      statuses: buildChartTabFromCards(chartCards, {
        title: 'Статусы партий',
        totalLabel: 'Всего',
        emptyLabel: 'Статусы'
      }, (card) => normalizeBatchStatusLabel(card.batchStatus || card.status), [
        '#43a047',
        '#ef4444',
        '#f97316',
        '#3b82f6',
        '#94a3b8',
        '#8b5cf6',
        '#eab308'
      ])
    };
  }

  return dashboard;
}

function normalizeBatchStatusLabel(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'Без статуса';
  if (value.includes('active')) return 'Active';
  if (value.includes('problem')) return 'Problem';
  if (value.includes('quarantine')) return 'Quarantine';
  if (value.includes('partial')) return 'Partial';
  if (value.includes('sold')) return 'Sold';
  if (value.includes('archiv')) return 'Archived';
  return status;
}

function buildChartTabFromCards(cards, meta, getKey, palette) {
  const counts = new Map();
  for (const card of cards) {
    const key = getKey(card);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const entries = sortStageEntries([...counts.entries()]);
  const total = cards.length;
  let cursor = 0;
  const slices = entries.map(([label, value], index) => {
    const percent = total ? (value / total) * 100 : 0;
    const slice = {
      label,
      value,
      color: palette[index % palette.length],
      start: cursor,
      end: cursor + percent
    };
    cursor += percent;
    return slice;
  });

  return {
    ...meta,
    total,
    slices,
    legend: slices.slice(0, 6),
    chartBackground: slices.length
      ? `conic-gradient(${slices.map((slice) => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`).join(', ')})`
      : 'conic-gradient(#e5e7eb 0 100%)'
  };
}

function hasProblemSignals(card) {
  if (!card) {
    return false;
  }

  const statusText = String(card.batchStatus || card.status || '').toLowerCase();
  const sterilityText = String(card.sterilityStatus || '').toLowerCase();
  const eventProblem = (card.events || []).some((event) => event && (event.problem || event.problemType || event.risk || event.riskLevel));

  return Boolean(
    card.problem ||
    card.problemType ||
    card.risk ||
    card.riskLevel ||
    statusText.includes('problem') ||
    statusText.includes('risk') ||
    statusText.includes('quarantine') ||
    sterilityText.includes('contamin') ||
    eventProblem
  );
}

function collectProblemEntriesFromReports(reports) {
  const entries = [];

  for (const report of reports || []) {
    const cards = Array.isArray(report.cards) ? report.cards : [];

    for (const card of cards) {
      if (hasProblemSignals(card)) {
        entries.push({
          ...buildProblemEntry(card),
          reportId: report.reportId,
          displayCreatedAt: report.displayCreatedAt
        });
      }

      for (const event of card.events || []) {
        if (event && (event.problem || event.problemType || event.risk || event.riskLevel)) {
          entries.push({
            ...buildProblemEntry(card, event),
            reportId: report.reportId,
            displayCreatedAt: report.displayCreatedAt
          });
        }
      }
    }
  }

  return entries;
}

function buildProblemEntry(card, event = null) {
  const source = event || card || {};
  const statusText = String(source.batchStatus || source.status || card.batchStatus || card.status || '').toLowerCase();
  const sterilityText = String(card.sterilityStatus || '').toLowerCase();
  const statusLabel = describeProblemStatus(statusText, sterilityText);
  const problem = source.problem || source.problemType || source.risk || source.riskLevel || card.problem || card.problemType || card.risk || card.riskLevel || firstProblemNote(card) || statusLabel || firstRiskNote(card) || 'Требует внимания';
  const risk = source.risk || source.riskLevel || card.risk || card.riskLevel || firstRiskNote(card);

  return {
    ...card,
    code: card.code,
    stage: source.stage || card.stage || card.batchStatus || card.status,
    batchStatus: card.batchStatus,
    status: card.status,
    createdAt: source.createdAt || card.createdAt || '',
    date: source.date || card.date || source.createdAt || card.createdAt || '',
    problem,
    risk,
    problemType: source.problemType || card.problemType,
    riskLevel: source.riskLevel || card.riskLevel,
    problemSource: event ? 'event' : 'card',
    problemSourceType: source.type || source.title || '',
    problemSourceStatus: statusText || sterilityText ? `${statusText}${statusText && sterilityText ? ' ' : ''}${sterilityText}`.trim() : ''
  };
}

function problemEntryTimestamp(entry) {
  return new Date(entry && (entry.createdAt || entry.date || 0)).getTime() || 0;
}

function describeProblemStatus(statusText, sterilityText) {
  if (sterilityText.includes('contamin')) {
    return 'Контаминация';
  }
  if (statusText.includes('quarantine')) {
    return 'Карантин';
  }
  if (statusText.includes('problem')) {
    return 'Требует внимания';
  }
  if (statusText.includes('risk')) {
    return 'Риск';
  }
  return '';
}

function firstProblemNote(card) {
  const event = (card && Array.isArray(card.events) ? card.events : []).find((item) => item && (item.problem || item.problemType || item.risk || item.riskLevel));
  if (!event) {
    return '';
  }

  return event.problem || event.problemType || event.risk || event.riskLevel || '';
}

function firstRiskNote(card) {
  const event = (card && Array.isArray(card.events) ? card.events : []).find((item) => item && (item.risk || item.riskLevel || item.problem || item.problemType));
  if (!event) {
    return '';
  }

  return event.risk || event.riskLevel || event.problem || event.problemType || '';
}

const STAGE_ORDER = [
  'Введение в культуру',
  'Клонирование',
  'Адаптация',
  'Теплица',
  'Закалка',
  'Высадка'
];

function sortStageEntries(entries) {
  const orderMap = new Map(STAGE_ORDER.map((label, index) => [label.toLowerCase(), index]));
  return entries.sort((left, right) => {
    const leftRank = orderMap.has(String(left[0] || '').trim().toLowerCase()) ? orderMap.get(String(left[0] || '').trim().toLowerCase()) : Number.POSITIVE_INFINITY;
    const rightRank = orderMap.has(String(right[0] || '').trim().toLowerCase()) ? orderMap.get(String(right[0] || '').trim().toLowerCase()) : Number.POSITIVE_INFINITY;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return String(left[0] || '').localeCompare(String(right[0] || ''), 'ru');
  });
}

module.exports = { createApp };
