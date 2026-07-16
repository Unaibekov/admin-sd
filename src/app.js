const express = require('express');
const multer = require('multer');
const path = require('path');
const { buildDashboard, buildFlashMessage } = require('./dashboardModel');
const { buildReportsPageModel } = require('./reportsPageModel');
const { buildJournalPageModel } = require('./journalPageModel');
const { buildStagesPageModel } = require('./stagesPageModel');
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
      const reportsPage = buildReportsPageModel(reports, req.query);
      const selectedReportId =
        reportsPage.selectedEmployee && Array.isArray(reportsPage.selectedEmployee.reports) && reportsPage.selectedEmployee.reports.length
          ? reportsPage.selectedEmployee.reports[0].reportId
          : '';
      const selectedReport = selectedReportId ? await getReport(selectedReportId) : null;

      res.render('reports', {
        pageTitle: 'Отчеты',
        activePage: 'reports',
        showDashboardLink: reports.length > 0,
        reportsPage,
        selectedReport
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/journal', async (req, res, next) => {
    try {
      const reports = await listReports();
      const detailedReports = await Promise.all(reports.map((report) => getReport(report.reportId)));
      const loadedReports = detailedReports.filter(Boolean);
      const journal = buildJournalPageModel(loadedReports, req.query);

      res.render('journal', {
        pageTitle: 'Журнал',
        activePage: 'journal',
        showDashboardLink: loadedReports.length > 0,
        journal
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/stages', async (req, res, next) => {
    try {
      const reports = await listReports();
      const detailedReports = await Promise.all(reports.map((report) => getReport(report.reportId)));
      const loadedReports = detailedReports.filter(Boolean);
      const stages = buildStagesPageModel(loadedReports, req.query);

      res.render('stages', {
        pageTitle: 'Партии',
        activePage: 'stages',
        showDashboardLink: loadedReports.length > 0,
        stages
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

module.exports = { createApp };
