const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { buildDashboard, buildFlashMessage } = require('./dashboardModel');
const { buildReportDashboardModel } = require('./reportDashboardModel');
const { buildReportsPageModel, buildReportsContentModel, resolveReportEmployeeKey } = require('./reportsPageModel');
const { buildJournalPageModel } = require('./journalPageModel');
const { buildStagesPageModel } = require('./stagesPageModel');
const {
  listReports,
  clearAllReports,
  getReport,
  processUploadedReport,
  reportFilePath,
  reportPhotoPath
} = require('./reportStore');

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'sadovnik-admin-uploads');
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_SIZE_BYTES = Number(process.env.SADOVNIK_MAX_UPLOAD_FILE_BYTES || 50 * 1024 * 1024);
const REPORT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/;

function formatUploadLimit(bytes) {
  const megabytes = Math.max(1, Math.round(bytes / (1024 * 1024)));
  return `${megabytes} \u041c\u0411`;
}

function uploadPageModel(overrides = {}) {
  return {
    pageTitle: '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043e\u0442\u0447\u0435\u0442\u0430',
    error: null,
    showDashboardLink: false,
    uploadLimitText: `\u041c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 \u0440\u0430\u0437\u043c\u0435\u0440 \u043e\u0434\u043d\u043e\u0433\u043e \u0430\u0440\u0445\u0438\u0432\u0430: ${formatUploadLimit(MAX_UPLOAD_FILE_SIZE_BYTES)}`,
    ...overrides
  };
}

async function buildUploadPageModel(overrides = {}) {
  const reports = await listReports().catch(() => []);
  return uploadPageModel({
    showDashboardLink: reports.length > 0,
    ...overrides
  });
}

async function buildNavigationState(overrides = {}) {
  const reports = await listReports().catch(() => []);
  return {
    hasReports: reports.length > 0,
    showDashboardLink: reports.length > 0,
    ...overrides
  };
}

async function buildErrorPageModel(overrides = {}) {
  const navigationState = await buildNavigationState();
  return {
    activePage: navigationState.hasReports ? 'dashboard' : 'error',
    showDashboardLink: navigationState.showDashboardLink,
    ...overrides
  };
}

async function buildReportPageModel(overrides = {}) {
  const navigationState = await buildNavigationState();
  return {
    showDashboardLink: navigationState.showDashboardLink,
    ...overrides
  };
}

async function getReadableReportOrNull(reportId) {
  try {
    return await getReport(reportId);
  } catch (error) {
    if (error && (error.internalCode || error.statusCode)) {
      throw error;
    }
    return null;
  }
}

function parseRequestedReportId(value) {
  const reportId = String(value || '').trim();
  if (!reportId) {
    return '';
  }

  return REPORT_ID_PATTERN.test(reportId) ? reportId : '';
}

function getRequiredRequestedReportId(value) {
  const reportId = parseRequestedReportId(value);
  if (reportId) {
    return reportId;
  }

  throw createMissingReportFileError(String(value || '').trim() || 'report');
}

function createMissingReportFileError(reportId) {
  const error = new Error(`Unreadable report: ${reportId}`);
  error.userMessage = '\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442.';
  error.statusCode = 404;
  return error;
}

function getUploadErrorMessage(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return `\u0420\u0430\u0437\u043c\u0435\u0440 \u043e\u0434\u043d\u043e\u0433\u043e ZIP-\u0430\u0440\u0445\u0438\u0432\u0430 \u043d\u0435 \u0434\u043e\u043b\u0436\u0435\u043d \u043f\u0440\u0435\u0432\u044b\u0448\u0430\u0442\u044c ${formatUploadLimit(MAX_UPLOAD_FILE_SIZE_BYTES)}.`;
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return `\u0417\u0430 \u043e\u0434\u0438\u043d \u0440\u0430\u0437 \u043c\u043e\u0436\u043d\u043e \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 ${MAX_UPLOAD_FILES} ZIP-\u0430\u0440\u0445\u0438\u0432\u043e\u0432.`;
    }
  }

  return error && error.userMessage ? error.userMessage : '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043d\u044b\u0439 \u0430\u0440\u0445\u0438\u0432.';
}

function createUploadStorage() {
  return multer.diskStorage({
    destination(req, file, cb) {
      try {
        fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
        cb(null, UPLOAD_TMP_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    }
  });
}

async function cleanupUploadedFiles(files = []) {
  await Promise.all(files.map(async (file) => {
    if (!file || !file.path) return;
    await fsp.rm(file.path, { force: true }).catch(() => {});
  }));
}

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.urlencoded({ extended: false }));
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  const upload = multer({
    storage: createUploadStorage(),
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES }
  });

  app.get('/', async (req, res, next) => {
    try {
      const reports = await listReports();
      const detailedReports = await Promise.all(reports.map((report) => getReport(report.reportId)));
      const loadedReports = detailedReports.filter(Boolean);
      const latestReport = loadedReports.length ? loadedReports[0] : null;
      const requestedReportId = parseRequestedReportId(req.query.reportId);
      const selectedReport = requestedReportId
        ? loadedReports.find((report) => report.reportId === requestedReportId) || null
        : latestReport;
      const effectiveReportId = selectedReport && requestedReportId ? selectedReport.reportId : '';
      const dashboardReports = effectiveReportId ? [selectedReport] : loadedReports;
      const dashboard = buildDashboard(reports, selectedReport || latestReport, dashboardReports, {
        ...req.query,
        reportId: effectiveReportId
      });
      const flashMessage = buildFlashMessage(req.query);
      dashboard.selectedReportId = effectiveReportId;

      res.render('index', {
        reports,
        dashboard,
        latestReport,
        pageTitle: '\u0414\u0430\u0448\u0431\u043e\u0440\u0434',
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
      const requestedReportId = parseRequestedReportId(req.query.reportId);
      const requestedReportSummary = requestedReportId
        ? reports.find((report) => report.reportId === requestedReportId) || null
        : null;
      const reportsPage = buildReportsPageModel(reports, requestedReportSummary
        ? { ...req.query, employee: resolveReportEmployeeKey(requestedReportSummary, reports) }
        : req.query);
      const fallbackSelectedEmployee = reportsPage.selectedEmployee
        || (reportsPage.employees[0] ? reportsPage.employees[0] : null);

      if (fallbackSelectedEmployee && !reportsPage.selectedEmployee) {
        reportsPage.selectedEmployee = fallbackSelectedEmployee;
        reportsPage.selectedEmployeeKey = fallbackSelectedEmployee.key;
        reportsPage.hasSelectedEmployee = true;
      }

      const employeeGroups = [];
      const pushEmployeeGroup = (employee) => {
        if (!employee || !employee.key || employeeGroups.some((group) => group.key === employee.key)) {
          return;
        }

        employeeGroups.push(employee);
      };

      pushEmployeeGroup(fallbackSelectedEmployee || reportsPage.selectedEmployee || null);
      (reportsPage.employees || []).forEach(pushEmployeeGroup);

      let selectedReport = null;
      let selectedEmployeeForReport = fallbackSelectedEmployee || reportsPage.selectedEmployee || null;

      for (const employee of employeeGroups) {
        const employeeReports = Array.isArray(employee.reports) ? employee.reports : [];
        const selectedReportCandidates = [];
        const requestedEmployeeReportId = employeeReports.find((report) => report.reportId === requestedReportId)?.reportId;
        if (requestedEmployeeReportId) {
          selectedReportCandidates.push(requestedEmployeeReportId);
        }
        employeeReports.forEach((report) => {
          if (report && report.reportId && !selectedReportCandidates.includes(report.reportId)) {
            selectedReportCandidates.push(report.reportId);
          }
        });

        for (const candidateReportId of selectedReportCandidates) {
          selectedReport = await getReport(candidateReportId);
          if (selectedReport) {
            selectedEmployeeForReport = employee;
            break;
          }
        }

        if (selectedReport) {
          break;
        }
      }

      if (selectedEmployeeForReport) {
        reportsPage.selectedEmployee = selectedEmployeeForReport;
        reportsPage.selectedEmployeeKey = selectedEmployeeForReport.key;
        reportsPage.employeeReports = Array.isArray(selectedEmployeeForReport.reports)
          ? selectedEmployeeForReport.reports
          : [];
        reportsPage.selectedReportSummary = selectedReport
          ? reportsPage.employeeReports.find((report) => report.reportId === selectedReport.reportId) || null
          : null;
        reportsPage.selectedReportId = reportsPage.selectedReportSummary
          ? reportsPage.selectedReportSummary.reportId
          : '';
        reportsPage.isLatestReport = Boolean(
          reportsPage.selectedReportSummary
          && reportsPage.employeeReports[0]
          && reportsPage.selectedReportSummary.reportId === reportsPage.employeeReports[0].reportId
        );
        reportsPage.hasSelectedReport = Boolean(reportsPage.selectedReportSummary);
        reportsPage.hasSelectedEmployee = true;
      }

      const reportDashboard = selectedReport ? buildReportDashboardModel(selectedReport) : null;
      const reportsContent = selectedReport && reportDashboard
        ? buildReportsContentModel(reportsPage, selectedReport, reportDashboard)
        : null;

      res.render('reports', {
        pageTitle: '\u041e\u0442\u0447\u0435\u0442\u044b',
        activePage: 'reports',
        showDashboardLink: reports.length > 0,
        reportsPage,
        selectedReport,
        reportDashboard,
        reportsContent
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
      const requestedReportId = parseRequestedReportId(req.query.reportId);
      const selectedReport = requestedReportId
        ? loadedReports.find((report) => report.reportId === requestedReportId) || null
        : null;
      const journalReports = selectedReport ? [selectedReport] : loadedReports;
      const effectiveReportId = selectedReport ? selectedReport.reportId : '';
      const journal = buildJournalPageModel(journalReports, {
        ...req.query,
        reportId: effectiveReportId
      });
      journal.selectedReportId = effectiveReportId;

      res.render('journal', {
        pageTitle: '\u0416\u0443\u0440\u043d\u0430\u043b',
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
      const requestedReportId = parseRequestedReportId(req.query.reportId);
      const selectedReport = requestedReportId
        ? loadedReports.find((report) => report.reportId === requestedReportId) || null
        : null;
      const stagesReports = selectedReport ? [selectedReport] : loadedReports;
      const effectiveReportId = selectedReport ? selectedReport.reportId : '';
      const stages = buildStagesPageModel(stagesReports, {
        ...req.query,
        reportId: effectiveReportId
      });
      stages.selectedReportId = effectiveReportId;

      res.render('stages', {
        pageTitle: '\u041f\u0430\u0440\u0442\u0438\u0438',
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
      if (String((req.body && req.body.confirm) || '').trim() !== 'clear-all') {
        return res.status(400).render('error', await buildErrorPageModel({
          pageTitle: '\u041e\u0448\u0438\u0431\u043a\u0430',
          message: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043e\u0447\u0438\u0441\u0442\u043a\u0443 \u043e\u0442\u0447\u0435\u0442\u043e\u0432.'
        }));
      }

      await clearAllReports();
      res.redirect(303, '/?cleared=1');
    } catch (error) {
      next(error);
    }
  });

  app.get('/upload', async (req, res, next) => {
    try {
      res.render('upload', await buildUploadPageModel());
    } catch (error) {
      next(error);
    }
  });

  app.post('/upload', upload.array('reportZip', MAX_UPLOAD_FILES), async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];

    try {
      if (!files.length) {
        return res.status(400).render('upload', await buildUploadPageModel({
          error: '\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0438\u043b\u0438 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 \u043e\u0434\u043d\u043e\u0433\u043e ZIP-\u0430\u0440\u0445\u0438\u0432\u0430.'
        }));
      }

      const results = [];
      for (const file of files) {
        if (path.extname(file.originalname).toLowerCase() !== '.zip') {
          results.push({
            ok: false,
            error: '\u041f\u0440\u0438\u043d\u0438\u043c\u0430\u044e\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e ZIP-\u0430\u0440\u0445\u0438\u0432\u044b.'
          });
          continue;
        }

        try {
          const reportId = await processUploadedReport(file.path, file.originalname);
          results.push({ ok: true, reportId });
        } catch (error) {
          results.push({
            ok: false,
            error: getUploadErrorMessage(error)
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
      res.status(400).render('upload', await buildUploadPageModel({
        error: getUploadErrorMessage(error)
      }));
    } finally {
      await cleanupUploadedFiles(files);
    }
  });

  app.get('/reports/:reportId', async (req, res, next) => {
    try {
      const reportId = getRequiredRequestedReportId(req.params.reportId);
      try {
        reportFilePath(reportId, 'report.json');
      } catch (error) {
        if (error && error.internalCode === 'HIDDEN_REPORT') {
          throw error;
        }
      }
      const report = await getReadableReportOrNull(reportId);
      if (!report) {
        return res.status(404).render('error', await buildErrorPageModel({
          pageTitle: '\u041e\u0442\u0447\u0435\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d',
          message: '\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442.'
        }));
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
      const reportDashboard = buildReportDashboardModel(report);
      res.render('report', await buildReportPageModel({
        pageTitle: `\u041e\u0442\u0447\u0435\u0442 ${report.reportId}`,
        report: model,
        reportDashboard,
        filters
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports/:reportId/raw', async (req, res, next) => {
    try {
      const reportId = getRequiredRequestedReportId(req.params.reportId);
      const file = reportFilePath(reportId, 'report.json');
      const report = await getReadableReportOrNull(reportId);
      if (!report) {
        throw createMissingReportFileError(reportId);
      }
      res.download(file, `${reportId}-report.json`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports/:reportId/zip', async (req, res, next) => {
    try {
      const reportId = getRequiredRequestedReportId(req.params.reportId);
      const file = reportFilePath(reportId, 'original.zip');
      const report = await getReadableReportOrNull(reportId);
      if (!report) {
        throw createMissingReportFileError(reportId);
      }
      res.download(file, `${reportId}.zip`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/reports/:reportId/photos/*', async (req, res, next) => {
    try {
      const reportId = getRequiredRequestedReportId(req.params.reportId);
      const file = reportPhotoPath(reportId, req.params[0] || '');
      const report = await getReadableReportOrNull(reportId);
      if (!report) {
        throw createMissingReportFileError(reportId);
      }
      res.sendFile(file);
    } catch (error) {
      next(error);
    }
  });

  app.use(async (req, res) => {
    res.status(404).render('error', await buildErrorPageModel({
      pageTitle: '\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430',
      message: '\u0417\u0430\u043f\u0440\u043e\u0448\u0435\u043d\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430.'
    }));
  });

  app.use(async (error, req, res, _next) => {
    if (req.method === 'POST' && req.path === '/upload' && error instanceof multer.MulterError) {
      return res.status(400).render('upload', await buildUploadPageModel({
        error: getUploadErrorMessage(error)
      }));
    }

    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error(error && error.stack ? error.stack : error);
    }
    const message = status >= 500
      ? (error.userMessage || '\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430.')
      : (error.userMessage || error.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u043f\u0440\u043e\u0441.');
    res.status(status).render('error', await buildErrorPageModel({
      pageTitle: '\u041e\u0448\u0438\u0431\u043a\u0430',
      message
    }));
  });

  return app;
}

module.exports = { createApp };
