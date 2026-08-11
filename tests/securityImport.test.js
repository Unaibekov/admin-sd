const assert = require('assert/strict');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, '/');
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = entry.directory ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const crc = entry.directory ? 0 : crc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    const localPart = Buffer.concat([localHeader, nameBuffer, dataBuffer]);
    const centralPart = Buffer.concat([centralHeader, nameBuffer]);
    localParts.push(localPart);
    centralParts.push(centralPart);
    offset += localPart.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localDirectory.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localDirectory, centralDirectory, endRecord]);
}

function buildValidReport(reportId = 'report-security-1') {
  return {
    reportId,
    createdAt: '2026-07-30T10:00:00.000Z',
    deviceId: 'device-1',
    user: {
      userId: 'user-1',
      displayName: 'Local User',
      role: 'operator'
    },
    summary: {
      cardsCount: 1,
      eventsCount: 1,
      photosCount: 1,
      problemsCount: 0,
      activeCount: 1,
      soldCount: 0
    },
    cards: [{
      cardId: 'card-1',
      code: 'CARD-1',
      stage: 'Greenhouse',
      batchStatus: 'active',
      createdAt: '2026-07-30',
      events: [{
        eventId: 'event-1',
        type: 'rooting',
        createdAt: '2026-07-30T10:05:00.000Z',
        photoFiles: ['photos/card.jpg']
      }]
    }]
  };
}

function buildZipFromReport(report, extraEntries = []) {
  return createZip([
    {
      name: 'report.json',
      data: JSON.stringify(report)
    },
    {
      name: 'photos/card.jpg',
      data: Buffer.from('fake-image')
    },
    ...extraEntries
  ]);
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadModules(dataDir) {
  process.env.SADOVNIK_DATA_DIR = dataDir;
  clearModule('../src/reportStore');
  clearModule('../src/app');
  return {
    reportStore: require('../src/reportStore'),
    createApp: require('../src/app').createApp
  };
}

function loadModulesWithPatchedModules(dataDir, options = {}) {
  process.env.SADOVNIK_DATA_DIR = dataDir;
  clearModule('../src/reportStore');
  clearModule('../src/reportDashboardModel');
  clearModule('../src/app');
  const reportStore = require('../src/reportStore');
  const reportDashboardModel = require('../src/reportDashboardModel');
  if (typeof options.patchReportStore === 'function') {
    options.patchReportStore(reportStore);
  }
  if (typeof options.patchReportDashboardModel === 'function') {
    options.patchReportDashboardModel(reportDashboardModel);
  }
  return {
    reportStore,
    reportDashboardModel,
    createApp: require('../src/app').createApp
  };
}

function loadServerConfig(dataDir) {
  process.env.SADOVNIK_DATA_DIR = dataDir;
  clearModule('../src/reportStore');
  clearModule('../src/app');
  clearModule('../server');
  return require('../server');
}

async function withTempDir(fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-admin-test-'));
  try {
    return await fn(tempDir);
  } finally {
    await removeDirWithRetry(tempDir);
  }
}

async function removeDirWithRetry(targetPath, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function request(server, targetPath) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: targetPath
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks),
          headers: res.headers
        });
      });
    });
    req.on('error', reject);
  });
}

async function requestWithBody(server, method, targetPath, body, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: targetPath,
      method,
      headers: {
        'Content-Length': body.length,
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks),
          headers: res.headers
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function createMultipartBody(parts) {
  const boundary = `----sadovnik-test-${Date.now().toString(16)}`;
  const chunks = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(String(part.data || ''), 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function requestMultipart(server, targetPath, parts) {
  const { body, contentType } = createMultipartBody(parts);
  return requestWithBody(server, 'POST', targetPath, body, {
    'Content-Type': contentType
  });
}

function assertNoCommonMojibake(text) {
  assert.doesNotMatch(
    String(text || ''),
    /(?:\u0420.|\u0421.|\u0432\u0402.){3,}/,
    'response should not contain mojibake'
  );
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

async function main() {
  await run('binds server to localhost by default', async () => {
    await withTempDir(async (dataDir) => {
      delete process.env.HOST;
      const { host } = loadServerConfig(dataDir);
      assert.equal(host, '127.0.0.1');
    });
  });

  await run('returns readable fallback text for missing display date', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      assert.equal(reportStore.formatDateValue(''), '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
    });
  });

  await run('shows the actual upload size limit on the upload page', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/upload');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u041c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 \u0440\u0430\u0437\u043c\u0435\u0440 \u043e\u0434\u043d\u043e\u0433\u043e \u0430\u0440\u0445\u0438\u0432\u0430: 50 \u041c\u0411/);
        assert.match(body, /<title>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043e\u0442\u0447\u0435\u0442\u0430 \| \u0410\u0434\u043c\u0438\u043d\u043a\u0430 Sadovnik Diary<\/title>/);
      } finally {
        server.close();
      }
    });
  });

  await run('shows upload page as the primary route when there are no reports yet', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/upload');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e/);
        assert.doesNotMatch(body, /class="sidebar-item active" href="\/">[\s\S]*<span>\u0420\u201c\u0420\u00bb\u0420\u00b0\u0420\u0456\u0420\u2026\u0420\u00b0\u0421\u040f<\/span>/);
        assert.doesNotMatch(body, /\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043d\u0430 \u0434\u0430\u0448\u0431\u043e\u0440\u0434/);
        assert.match(body, /<button type="button" class="sidebar-more">Подробнее<\/button>/);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.doesNotMatch(body, /href="#"/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable empty dashboard copy on the home page', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/?period=all');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /Нет данных для дашборда/);
        assert.match(body, /\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u043f\u0435\u0440\u0432\u044b\u0439 ZIP-\u043e\u0442\u0447\u0435\u0442 \u0438\u0437 Sadovnik Diary\./);
        assert.match(body, /\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0442\u0447\u0435\u0442/);
        assert.match(body, /<title>Дашборд \| Админка Sadovnik Diary<\/title>/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable populated dashboard sections on the home page', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-dashboard-1')), 'dashboard.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/?period=all');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u0441\u043e\u0431\u044b\u0442\u0438\u044f/);
        assert.match(body, /Проблемные партии/);
        assert.match(body, /\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u043e\u0442\u0447\u0435\u0442\u044b/);
        assert.match(body, /\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u0444\u043e\u0442\u043e/);
        assert.match(body, /1 партия/);
        assert.match(body, /1 \u0441\u043e\u0431\u044b\u0442\u0438\u0435/);
        assert.match(body, /1 фото/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable journal page copy', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/journal');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<title>\u0416\u0443\u0440\u043d\u0430\u043b \| \u0410\u0434\u043c\u0438\u043d\u043a\u0430 Sadovnik Diary<\/title>/);
        assert.match(body, /<h1>\u0416\u0443\u0440\u043d\u0430\u043b<\/h1>/);
        assert.match(body, /Фильтры/);
        assert.match(body, /Период/);
        assert.match(body, /\u0412\u0441\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438/);
        assert.match(body, /\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0444\u0438\u043b\u044c\u0442\u0440/);
        assert.match(body, /\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps journal sidebar state correct when reports exist but filters return no results', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-journal-empty-filter')), 'journal-empty-filter.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/journal?category=losses');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /Ничего не найдено/);
        assert.match(body, /<a class="sidebar-item active" href="\/journal">/);
        assert.doesNotMatch(body, /<a class="sidebar-item active" href="\/">/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable stages page copy', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-stages-1')), 'stages.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?cardId=card-1&tab=passport');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<title>\u041f\u0430\u0440\u0442\u0438\u0438 \| \u0410\u0434\u043c\u0438\u043d\u043a\u0430 Sadovnik Diary<\/title>/);
        assert.match(body, /<h1>\u041f\u0430\u0440\u0442\u0438\u0438<\/h1>/);
        assert.match(body, /\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438/);
        assert.match(body, /\u0421\u0442\u0430\u0434\u0438\u0438/);
        assert.match(body, /\u041f\u0430\u0441\u043f\u043e\u0440\u0442/);
        assert.match(body, /\u0416\u0443\u0440\u043d\u0430\u043b/);
        assert.match(body, /\u0421\u0432\u043e\u0434\u043a\u0430/);
        assert.match(body, /\u0420\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435/);
        assert.match(body, /\u0418\u0441\u0442\u043e\u0440\u0438\u044f/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows batch problem details in stages passport', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-stages-problem-passport');
      report.summary.problemsCount = 1;
      report.cards[0].batchStatus = 'problem';
      report.cards[0].extraFields = {
        problemType: '\u041a\u0430\u0440\u0430\u043d\u0442\u0438\u043d',
        riskLevel: '\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439',
        problemDescription: '\u0418\u0437\u043e\u043b\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0430\u0440\u0442\u0438\u044e'
      };
      await reportStore.processUploadedReport(buildZipFromReport(report), 'stages-problem-passport.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?cardId=card-1&tab=passport');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u0430/);
        assert.match(body, /\u0422\u0438\u043f \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u044b/);
        assert.match(body, /\u041a\u0430\u0440\u0430\u043d\u0442\u0438\u043d/);
        assert.match(body, /\u0420\u0438\u0441\u043a/);
        assert.match(body, /\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439/);
        assert.match(body, /\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435/);
        assert.match(body, /\u0418\u0437\u043e\u043b\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0430\u0440\u0442\u0438\u044e/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows zero batch \u043e\u0441\u0442\u0430\u0442\u043e\u043a in stages instead of a dash', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-stages-zero-quantities');
      report.cards[0].currentQuantity = 0;
      await reportStore.processUploadedReport(buildZipFromReport(report), 'stages-zero-quantities.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?cardId=card-1&tab=passport');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u041e\u0441\u0442\u0430\u0442\u043e\u043a: 0 \u0448\u0442\./);
        assert.doesNotMatch(body, /\u041e\u0441\u0442\u0430\u0442\u043e\u043a: \u2014 \u0448\u0442\./);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows clone generation zero in stages passport without replacing it with one', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-stages-generation-zero');
      Object.assign(report.cards[0], {
        originType: 'cloned',
        parentCode: 'VK-PARENT',
        generation: 0,
        propagationMethod: '\u0427\u0435\u0440\u0435\u043d\u043a\u043e\u0432\u0430\u043d\u0438\u0435'
      });
      await reportStore.processUploadedReport(buildZipFromReport(report), 'stages-generation-zero.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?cardId=card-1&tab=passport');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\u041f\u0440\u043e\u0438\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0435/);
        assert.match(body, /\u041f\u043e\u043a\u043e\u043b\u0435\u043d\u0438\u0435<\/dt><dd>0<\/dd>/);
        assert.doesNotMatch(body, /\u041f\u043e\u043a\u043e\u043b\u0435\u043d\u0438\u0435<\/dt><dd>1<\/dd>/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable empty reports page copy', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports');
        const body = response.body.toString('utf8');
        assert.match(body, /<title>\u041e\u0442\u0447\u0435\u0442\u044b \| \u0410\u0434\u043c\u0438\u043d\u043a\u0430 Sadovnik Diary<\/title>/);
        assert.match(body, /<h1>\u041e\u0442\u0447\u0435\u0442\u044b<\/h1>/);
        assert.match(body, /\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0438\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0441\u0432\u043e\u0434\u043d\u0443\u044e \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044e\./);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows zero quantities on the reports dashboard instead of a dash', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-reports-zero-quantities');
      report.cards[0].currentQuantity = 0;
      await reportStore.processUploadedReport(buildZipFromReport(report), 'reports-zero-quantities.zip');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?employee=local%20user');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>0<\/strong>/);
        assert.doesNotMatch(body, /\u2014 \u0448\u0442\./);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows readable populated reports page copy', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-reports-1')), 'reports.zip');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?employee=local%20user');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<title>\u041e\u0442\u0447\u0435\u0442\u044b \| \u0410\u0434\u043c\u0438\u043d\u043a\u0430 Sadovnik Diary<\/title>/);
        assert.match(body, /\u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u043e\u0442\u0447\u0435\u0442\u043e\u0432 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u0432\./);
        assert.match(body, /<select name="employee" data-reports-employee>/);
        assert.doesNotMatch(body, /<select name="reportId" data-reports-report/);
        assert.doesNotMatch(body, /class="reports-meta-row"/);
        assert.doesNotMatch(body, /\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043e\u0442\u0447\u0435\u0442/);
        assert.doesNotMatch(body, /\u041e\u0442\u0447\u0435\u0442 \u043e\u0442 /);
        assert.match(body, /dashboard-stat-label">\u041f\u0430\u0440\u0442\u0438\u0438<\/span>\s*<strong>1<\/strong>/);
        assert.match(body, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>/);
        assert.match(body, /dashboard-stat-label">\u0421\u043e\u0431\u044b\u0442\u0438\u044f<\/span>\s*<strong>1<\/strong>/);
        assert.match(body, /\u0422\u0440\u0435\u0431\u0443\u044e\u0442 \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u044f/);
        assert.match(body, /\u0420\u0430\u0431\u043e\u0442\u0430 \u043f\u043e \u0441\u0442\u0430\u0434\u0438\u044f\u043c/);
        assert.match(body, /\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows batch status labels on the direct report dashboard', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-direct-batch-status');
      report.cards[0].batchStatus = 'quarantine';
      await reportStore.processUploadedReport(buildZipFromReport(report), 'report-direct-batch-status.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports/report-direct-batch-status');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<a class="sidebar-item active" href="\/reports">/);
        assert.doesNotMatch(body, /<a class="sidebar-item active" href="\/">/);
        assert.match(body, /batch-list-status batch-list-status-alert">Карантин</);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('uses batchId links for recent dashboard events with duplicate cardIds across devices', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-dashboard-batch-old');
      olderReport.createdAt = '2026-07-31T10:00:00.000Z';
      olderReport.deviceId = 'device-1';
      olderReport.cards[0].createdAt = '2026-07-31T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-31T10:00:00.000Z';
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].eventId = 'event-old';
      olderReport.cards[0].events[0].createdAt = '2026-07-31T10:05:00.000Z';

      const newerReport = buildValidReport('report-dashboard-batch-new');
      newerReport.createdAt = '2026-08-01T10:00:00.000Z';
      newerReport.deviceId = 'device-2';
      newerReport.cards[0].createdAt = '2026-08-01T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-08-01T10:00:00.000Z';
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].eventId = 'event-new';
      newerReport.cards[0].events[0].createdAt = '2026-08-01T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'dashboard-batch-old.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'dashboard-batch-new.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?period=all');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /\/stages\?batchId=device-2%3A%3Acard-1&amp;tab=journal&amp;eventId=event-new#journal/);

        const stagesResponse = await request(server, '/stages?batchId=device-2%3A%3Acard-1&tab=journal&eventId=event-new');
        const stagesBody = stagesResponse.body.toString('utf8');
        assert.equal(stagesResponse.statusCode, 200);
        assert.match(stagesBody, /data-selected-batch href="\/stages\?batchId=device-2%3A%3Acard-1"/);
        assert.doesNotMatch(stagesBody, /data-selected-batch href="\/stages\?batchId=device-1%3A%3Acard-1"/);
      } finally {
        server.close();
      }
    });
  });

  await run('opens latest problem events from dashboard feeds with batch context and eventId', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-dashboard-problem-links');
      report.cards[0].batchStatus = 'quarantine';
      report.cards[0].events = [{
        eventId: 'problem-event-1',
        type: 'problem',
        createdAt: '2026-08-01T10:05:00.000Z',
        problemType: 'РљР°СЂР°РЅС‚РёРЅ',
        riskLevel: '\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439',
        problemDescription: 'РР·РѕР»РёСЂРѕРІР°С‚СЊ РїР°СЂС‚РёСЋ'
      }];

      await reportStore.processUploadedReport(buildZipFromReport(report), 'dashboard-problem-links.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=problem-event-1#journal/);
        assert.doesNotMatch(homeBody, /href="\/stages\?batchId=device-1%3A%3Acard-1"/);

        const reportResponse = await request(server, '/reports/report-dashboard-problem-links');
        const reportBody = reportResponse.body.toString('utf8');
        assert.equal(reportResponse.statusCode, 200);
        assert.match(reportBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;reportId=report-dashboard-problem-links&amp;tab=journal&amp;eventId=problem-event-1#journal/);
        assert.doesNotMatch(reportBody, /href="\/stages\?batchId=device-1%3A%3Acard-1&amp;reportId=report-dashboard-problem-links"/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps duplicate cardIds from different devices separate in global journal links', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const firstReport = buildValidReport('report-journal-batch-a');
      firstReport.createdAt = '2026-07-31T10:00:00.000Z';
      firstReport.deviceId = 'device-1';
      firstReport.cards[0].events[0].eventId = 'event-device-1';
      firstReport.cards[0].events[0].createdAt = '2026-07-31T10:05:00.000Z';

      const secondReport = buildValidReport('report-journal-batch-b');
      secondReport.createdAt = '2026-08-01T10:00:00.000Z';
      secondReport.deviceId = 'device-2';
      secondReport.cards[0].events[0].eventId = 'event-device-2';
      secondReport.cards[0].events[0].createdAt = '2026-08-01T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'journal-batch-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'journal-batch-b.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/journal');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-device-1#journal/);
        assert.match(body, /\/stages\?batchId=device-2%3A%3Acard-1&amp;tab=journal&amp;eventId=event-device-2#journal/);
        assert.doesNotMatch(body, /\/stages\?cardId=card-1&amp;tab=journal/);
      } finally {
        server.close();
      }
    });
  });

  await run('scopes the home dashboard by reportId and keeps that context in child links', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-home-context-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Old User';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-home-context-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'New User';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'home-context-old.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'home-context-new.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?reportId=report-home-context-old&period=all');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /href="\/journal\?reportId=report-home-context-old"/);
        assert.match(homeBody, /href="\/journal\?reportId=report-home-context-old&amp;category=problems"/);
        assert.match(homeBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;reportId=report-home-context-old&amp;tab=journal&amp;eventId=event-1#journal/);
        assert.match(homeBody, /Old User/);
        assert.doesNotMatch(homeBody, /New User/);
        assert.doesNotMatch(homeBody, /report-home-context-new\/photos\/card\.jpg/);

        const stagesResponse = await request(server, '/stages?reportId=report-home-context-old&batchId=device-1%3A%3Acard-1&tab=journal&eventId=event-1');
        const stagesBody = stagesResponse.body.toString('utf8');
        assert.equal(stagesResponse.statusCode, 200);
        assert.match(stagesBody, /10 шт\./);
        assert.doesNotMatch(stagesBody, /7 из 10 шт\./);
      } finally {
        server.close();
      }
    });
  });

  await run('drops corrupted report context from the home dashboard and child links', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const corruptedReport = buildValidReport('report-home-corrupted-context');
      corruptedReport.createdAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.user.displayName = 'Broken User';
      corruptedReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.cards[0].quantity = 10;
      corruptedReport.cards[0].currentQuantity = 10;
      corruptedReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const readableReport = buildValidReport('report-home-readable-context');
      readableReport.createdAt = '2026-07-30T10:00:00.000Z';
      readableReport.user.displayName = 'Readable User';
      readableReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      readableReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      readableReport.cards[0].quantity = 10;
      readableReport.cards[0].currentQuantity = 7;
      readableReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      const corruptedReportId = await reportStore.processUploadedReport(buildZipFromReport(corruptedReport), 'home-corrupted-context.zip');
      await reportStore.processUploadedReport(buildZipFromReport(readableReport), 'home-readable-context.zip');
      await fs.writeFile(path.join(dataDir, 'reports', corruptedReportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?reportId=report-home-corrupted-context&period=all');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /Readable User/);
        assert.doesNotMatch(homeBody, /Broken User/);
        assert.doesNotMatch(homeBody, /reportId=report-home-corrupted-context/);
        assert.match(homeBody, /href="\/journal"/);
        assert.match(homeBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1#journal/);

        const stagesResponse = await request(server, '/stages?batchId=device-1%3A%3Acard-1&tab=journal&eventId=event-1');
        const stagesBody = stagesResponse.body.toString('utf8');
        assert.equal(stagesResponse.statusCode, 200);
        assert.match(stagesBody, /7 из 10 шт\./);
        assert.doesNotMatch(stagesBody, /name="reportId" value="report-home-corrupted-context"/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps exact report links from the home recent reports block when dashboard is scoped', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-home-recent-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Same User';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-home-recent-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Same User';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'home-recent-old.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'home-recent-new.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?reportId=report-home-recent-old');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /href="\/reports\?employee=same%20user&amp;reportId=report-home-recent-old"/);
        assert.match(homeBody, /href="\/reports\?employee=same%20user&amp;reportId=report-home-recent-old" class="dashboard-card-link">\u0412\u0441\u0435 \u043e\u0442\u0447\u0435\u0442\u044b<\/a>/);

        const reportsResponse = await request(server, '/reports?employee=same%20user&reportId=report-home-recent-old');
        const reportsBody = reportsResponse.body.toString('utf8');
        assert.equal(reportsResponse.statusCode, 200);
        assert.match(reportsBody, /<option value="same user" selected>\s*Same User\s*<\/option>/);
        assert.doesNotMatch(reportsBody, /<select name="reportId" data-reports-report/);
        assert.match(reportsBody, /dashboard-stat-label">Растения<\/span>\s*<strong>7<\/strong>/);
        assert.doesNotMatch(reportsBody, /dashboard-stat-label">Растения<\/span>\s*<strong>10<\/strong>/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps same-name employees separate in home recent reports links when userIds differ', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const firstReport = buildValidReport('report-home-same-name-a');
      firstReport.createdAt = '2026-07-29T10:00:00.000Z';
      firstReport.user.userId = 'same-user-a';
      firstReport.user.displayName = 'Same User';
      firstReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      firstReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      firstReport.cards[0].quantity = 10;
      firstReport.cards[0].currentQuantity = 10;
      firstReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const secondReport = buildValidReport('report-home-same-name-b');
      secondReport.createdAt = '2026-07-30T10:00:00.000Z';
      secondReport.user.userId = 'same-user-b';
      secondReport.user.displayName = 'Same User';
      secondReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      secondReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      secondReport.cards[0].quantity = 10;
      secondReport.cards[0].currentQuantity = 7;
      secondReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'home-same-name-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'home-same-name-b.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?period=all');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /href="\/reports\?employee=same-user-a&amp;reportId=report-home-same-name-a"/);
        assert.match(homeBody, /href="\/reports\?employee=same-user-b&amp;reportId=report-home-same-name-b"/);

        const firstReportsResponse = await request(server, '/reports?employee=same-user-a&reportId=report-home-same-name-a');
        const firstReportsBody = firstReportsResponse.body.toString('utf8');
        assert.equal(firstReportsResponse.statusCode, 200);
        assert.match(firstReportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>10<\/strong>/);
        assert.doesNotMatch(firstReportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>7<\/strong>/);

        const secondReportsResponse = await request(server, '/reports?employee=same-user-b&reportId=report-home-same-name-b');
        const secondReportsBody = secondReportsResponse.body.toString('utf8');
        assert.equal(secondReportsResponse.statusCode, 200);
        assert.match(secondReportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>7<\/strong>/);
        assert.doesNotMatch(secondReportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>10<\/strong>/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps exact report link in the home reports card when scoped period has no recent reports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const report = buildValidReport('report-home-recent-empty-period');
      report.createdAt = '2026-07-29T10:00:00.000Z';
      report.user.displayName = 'Same User';
      report.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      report.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      report.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(report), 'home-recent-empty-period.zip');

      const server = await startServer(createApp());
      try {
        const homeResponse = await request(server, '/?reportId=report-home-recent-empty-period&period=today');
        const homeBody = homeResponse.body.toString('utf8');
        assert.equal(homeResponse.statusCode, 200);
        assert.match(homeBody, /href="\/reports\?employee=same%20user&amp;reportId=report-home-recent-empty-period" class="dashboard-card-link"/);
        assert.doesNotMatch(homeBody, /href="\/reports" class="dashboard-card-link"/);
      } finally {
        server.close();
      }
    });
  });

  await run('does not render a report selector even when a legacy reportId link is opened', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-reports-picker-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Same User';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';
      const newerReport = buildValidReport('report-reports-picker-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Same User';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';
      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'reports-picker-old.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'reports-picker-new.zip');
      const server = await startServer(createApp());
      try {
        const reportsResponse = await request(server, '/reports?employee=same%20user&reportId=report-reports-picker-old');
        const reportsBody = reportsResponse.body.toString('utf8');
        assert.equal(reportsResponse.statusCode, 200);
        assert.match(reportsBody, /<select name="employee" data-reports-employee>/);
        assert.doesNotMatch(reportsBody, /<select name="reportId" data-reports-report/);
        assert.doesNotMatch(reportsBody, /report-reports-picker-old" selected/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps same-name employees separate on reports page when reportId restores the selection', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const firstReport = buildValidReport('report-reports-same-name-a');
      firstReport.createdAt = '2026-07-29T10:00:00.000Z';
      firstReport.user.userId = 'same-user-a';
      firstReport.user.displayName = 'Same User';
      firstReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      firstReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      firstReport.cards[0].quantity = 10;
      firstReport.cards[0].currentQuantity = 10;
      firstReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';
      const secondReport = buildValidReport('report-reports-same-name-b');
      secondReport.createdAt = '2026-07-30T10:00:00.000Z';
      secondReport.user.userId = 'same-user-b';
      secondReport.user.displayName = 'Same User';
      secondReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      secondReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      secondReport.cards[0].quantity = 10;
      secondReport.cards[0].currentQuantity = 7;
      secondReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';
      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'reports-same-name-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'reports-same-name-b.zip');
      const server = await startServer(createApp());
      try {
        const reportsResponse = await request(server, '/reports?reportId=report-reports-same-name-b');
        const reportsBody = reportsResponse.body.toString('utf8');
        assert.equal(reportsResponse.statusCode, 200);
        assert.match(reportsBody, /<option value="same-user-a"\s*>\s*Same User \(same-user-a\)\s*<\/option>/);
        assert.match(reportsBody, /<option value="same-user-b"\s*selected>\s*Same User \(same-user-b\)\s*<\/option>/);
        assert.match(reportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>7<\/strong>/);
      } finally {
        server.close();
      }
    });
  });

  await run('uses reportId only to restore the correct employee and still shows latest report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-reports-direct-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Same User';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';
      const newerReport = buildValidReport('report-reports-direct-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Same User';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';
      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'reports-direct-old.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'reports-direct-new.zip');
      const server = await startServer(createApp());
      try {
        const reportsResponse = await request(server, '/reports?reportId=report-reports-direct-old');
        const reportsBody = reportsResponse.body.toString('utf8');
        assert.equal(reportsResponse.statusCode, 200);
        assert.match(reportsBody, /<option value="same user" selected>\s*Same User\s*<\/option>/);
        assert.doesNotMatch(reportsBody, /<select name="reportId" data-reports-report/);
        assert.match(reportsBody, /dashboard-stat-label">\u0420\u0430\u0441\u0442\u0435\u043d\u0438\u044f<\/span>\s*<strong>7<\/strong>/);
      } finally {
        server.close();
      }
    });
  });

  await run('falls back to the latest report on reports page when reportId is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-reports-missing-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Older User';
      olderReport.user.userId = 'older-user';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].currentQuantity = 10;
      const newerReport = buildValidReport('report-reports-missing-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Newer User';
      newerReport.user.userId = 'newer-user';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].currentQuantity = 7;
      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-reports-missing.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-reports-missing.zip');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?reportId=missing-report-id');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<option value="newer user" selected>\s*Newer User\s*<\/option>/);
        assert.doesNotMatch(body, /<select name="reportId" data-reports-report/);
        assert.match(body, /href="\/journal\?reportId=report-reports-missing-new"/);
        assert.doesNotMatch(body, /reports-selection-empty/);
        assert.doesNotMatch(body, /reportId=missing-report-id/);
      } finally {
        server.close();
      }
    });
  });

  await run('falls back to the latest report on reports page when employee query is invalid', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-reports-invalid-employee-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Older User';
      olderReport.user.userId = 'older-user';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].currentQuantity = 10;
      const newerReport = buildValidReport('report-reports-invalid-employee-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Newer User';
      newerReport.user.userId = 'newer-user';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].currentQuantity = 7;
      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-reports-invalid-employee.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-reports-invalid-employee.zip');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?employee=missing-employee');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<option value="newer user" selected>\s*Newer User\s*<\/option>/);
        assert.doesNotMatch(body, /<select name="reportId" data-reports-report/);
        assert.match(body, /href="\/journal\?reportId=report-reports-invalid-employee-new"/);
        assert.doesNotMatch(body, /reports-selection-empty/);
        assert.doesNotMatch(body, /employee=missing-employee/);
      } finally {
        server.close();
      }
    });
  });

  await run('falls back to the latest readable employee report when the selected import is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-reports-corrupted-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.user.displayName = 'Same User';
      olderReport.user.userId = 'same-user';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].currentQuantity = 10;
      const newerReport = buildValidReport('report-reports-corrupted-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.user.displayName = 'Same User';
      newerReport.user.userId = 'same-user';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].currentQuantity = 7;
      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-reports-corrupted.zip');
      const newerReportId = await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-reports-corrupted.zip');
      await fs.writeFile(path.join(dataDir, 'reports', newerReportId, 'report.json'), '{"reportId":', 'utf8');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?employee=same%20user&reportId=report-reports-corrupted-new');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<option value="same user" selected>\s*Same User\s*<\/option>/);
        assert.doesNotMatch(body, /<select name="reportId" data-reports-report/);
        assert.match(body, /href="\/journal\?reportId=report-reports-corrupted-old"/);
        assert.match(body, /href="\/stages\?[^"]*reportId=report-reports-corrupted-old/);
        assert.doesNotMatch(body, /reportId=report-reports-corrupted-new/);
        assert.doesNotMatch(body, /reports-selection-empty/);
      } finally {
        server.close();
      }
    });
  });

  await run('falls back to the next readable employee when the selected employee reports are corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const corruptedReport = buildValidReport('report-reports-corrupted-employee-only');
      corruptedReport.createdAt = '2026-07-30T10:00:00.000Z';
      corruptedReport.user.displayName = 'Broken User';
      corruptedReport.user.userId = 'broken-user';
      corruptedReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      corruptedReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      corruptedReport.cards[0].currentQuantity = 7;
      const readableReport = buildValidReport('report-reports-readable-fallback');
      readableReport.createdAt = '2026-07-29T10:00:00.000Z';
      readableReport.user.displayName = 'Readable User';
      readableReport.user.userId = 'readable-user';
      readableReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      readableReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      readableReport.cards[0].currentQuantity = 10;
      const corruptedReportId = await reportStore.processUploadedReport(buildZipFromReport(corruptedReport), 'broken-user-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(readableReport), 'readable-user-report.zip');
      await fs.writeFile(path.join(dataDir, 'reports', corruptedReportId, 'report.json'), '{"reportId":', 'utf8');
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports?employee=broken%20user');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /<option value="readable user" selected>\s*Readable User\s*<\/option>/);
        assert.doesNotMatch(body, /<select name="reportId" data-reports-report/);
        assert.match(body, /href="\/journal\?reportId=report-reports-readable-fallback"/);
        assert.doesNotMatch(body, /reports-selection-empty/);
        assert.doesNotMatch(body, /employee=broken%20user&amp;reportId=report-reports-corrupted-employee-only/);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps report context in stages links from report dashboard and stages route respects reportId', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-stages-context-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-stages-context-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].batchStatus = 'quarantine';
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-report.zip');

      const server = await startServer(createApp());
      try {
        const reportResponse = await request(server, '/reports/report-stages-context-old');
        const reportBody = reportResponse.body.toString('utf8');
        assert.equal(reportResponse.statusCode, 200);
        assert.match(reportBody, /\/stages\?batchId=device-1%3A%3Acard-1&reportId=report-stages-context-old/);

        const stagesResponse = await request(server, '/stages?reportId=report-stages-context-old&batchId=device-1%3A%3Acard-1');
        const stagesBody = stagesResponse.body.toString('utf8');
        assert.equal(stagesResponse.statusCode, 200);
        assert.match(stagesBody, /name="reportId" value="report-stages-context-old"/);
        assert.match(stagesBody, /10 шт\./);
        assert.doesNotMatch(stagesBody, /7 из 10 шт\./);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps report context in stages links from report-scoped journal', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-journal-context-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-journal-context-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-journal-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-journal-report.zip');

      const server = await startServer(createApp());
      try {
        const journalResponse = await request(server, '/journal?reportId=report-journal-context-old');
        const journalBody = journalResponse.body.toString('utf8');
        assert.equal(journalResponse.statusCode, 200);
        assert.match(journalBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1&amp;reportId=report-journal-context-old#journal/);

        const stagesResponse = await request(server, '/stages?reportId=report-journal-context-old&batchId=device-1%3A%3Acard-1&tab=journal&eventId=event-1');
        const stagesBody = stagesResponse.body.toString('utf8');
        assert.equal(stagesResponse.statusCode, 200);
        assert.match(stagesBody, /name="reportId" value="report-journal-context-old"/);
        assert.match(stagesBody, /10 шт\./);
        assert.doesNotMatch(stagesBody, /7 из 10 шт\./);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps report context in stages tab links for a selected batch', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-stages-tabs-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-stages-tabs-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-stages-tabs-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-stages-tabs-report.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?reportId=report-stages-tabs-old&cardId=card-1&tab=journal&eventId=event-1');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.match(body, /\/stages\?reportId=report-stages-tabs-old&amp;batchId=device-1%3A%3Acard-1&amp;tab=passport#passport/);
        assert.match(body, /\/stages\?reportId=report-stages-tabs-old&amp;batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1#journal/);
      } finally {
        server.close();
      }
    });
  });

  await run('drops missing report context from report-scoped journal links', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-journal-fallback-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-journal-fallback-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-journal-fallback-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-journal-fallback-report.zip');

      const server = await startServer(createApp());
      try {
        const journalResponse = await request(server, '/journal?reportId=missing-report-id&period=all');
        const journalBody = journalResponse.body.toString('utf8');
        assert.equal(journalResponse.statusCode, 200);
        assert.doesNotMatch(journalBody, /name="reportId" value="missing-report-id"/);
        assert.doesNotMatch(journalBody, /reportId=missing-report-id/);
        assert.match(journalBody, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1#journal/);
      } finally {
        server.close();
      }
    });
  });

  await run('drops missing report context from stages filters and tabs', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const olderReport = buildValidReport('report-stages-fallback-old');
      olderReport.createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      olderReport.cards[0].quantity = 10;
      olderReport.cards[0].currentQuantity = 10;
      olderReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const newerReport = buildValidReport('report-stages-fallback-new');
      newerReport.createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      newerReport.cards[0].quantity = 10;
      newerReport.cards[0].currentQuantity = 7;
      newerReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      await reportStore.processUploadedReport(buildZipFromReport(olderReport), 'older-stages-fallback-report.zip');
      await reportStore.processUploadedReport(buildZipFromReport(newerReport), 'newer-stages-fallback-report.zip');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?reportId=missing-report-id&batchId=device-1%3A%3Acard-1&tab=journal&eventId=event-1');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.doesNotMatch(body, /name="reportId" value="missing-report-id"/);
        assert.doesNotMatch(body, /reportId=missing-report-id/);
        assert.match(body, /<dd>7[^<]*10[^<]*<\/dd>/);
        assert.match(body, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=passport#passport/);
        assert.match(body, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1#journal/);
      } finally {
        server.close();
      }
    });
  });

  await run('drops corrupted report context from stages filters and tabs', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const corruptedReport = buildValidReport('report-stages-corrupted-context');
      corruptedReport.createdAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.cards[0].createdAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.cards[0].updatedAt = '2026-07-29T10:00:00.000Z';
      corruptedReport.cards[0].quantity = 10;
      corruptedReport.cards[0].currentQuantity = 10;
      corruptedReport.cards[0].events[0].createdAt = '2026-07-29T10:05:00.000Z';

      const readableReport = buildValidReport('report-stages-readable-context');
      readableReport.createdAt = '2026-07-30T10:00:00.000Z';
      readableReport.cards[0].createdAt = '2026-07-30T10:00:00.000Z';
      readableReport.cards[0].updatedAt = '2026-07-30T10:00:00.000Z';
      readableReport.cards[0].quantity = 10;
      readableReport.cards[0].currentQuantity = 7;
      readableReport.cards[0].events[0].createdAt = '2026-07-30T10:05:00.000Z';

      const corruptedReportId = await reportStore.processUploadedReport(buildZipFromReport(corruptedReport), 'stages-corrupted-context.zip');
      await reportStore.processUploadedReport(buildZipFromReport(readableReport), 'stages-readable-context.zip');
      await fs.writeFile(path.join(dataDir, 'reports', corruptedReportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, '/stages?reportId=report-stages-corrupted-context&batchId=device-1%3A%3Acard-1&tab=journal&eventId=event-1');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 200);
        assert.doesNotMatch(body, /name="reportId" value="report-stages-corrupted-context"/);
        assert.doesNotMatch(body, /reportId=report-stages-corrupted-context/);
        assert.match(body, /<dd>7[^<]*10[^<]*<\/dd>/);
        assert.match(body, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=passport#passport/);
        assert.match(body, /\/stages\?batchId=device-1%3A%3Acard-1&amp;tab=journal&amp;eventId=event-1#journal/);
      } finally {
        server.close();
      }
    });
  });

  await run('uses readable fallback author when report user is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-no-author-1');
      delete report.user;

      await reportStore.processUploadedReport(buildZipFromReport(report), 'no-author.zip');
      const reports = await reportStore.listReports();

      assert.equal(reports.length, 1);
      assert.equal(reports[0].author, '\u0410\u0432\u0442\u043e\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d');
    });
  });

  await run('ignores blank report display names and falls back to readable author text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-blank-author-1');
      report.user.displayName = '   ';

      await reportStore.processUploadedReport(buildZipFromReport(report), 'blank-author.zip');
      const reports = await reportStore.listReports();

      assert.equal(reports.length, 1);
      assert.equal(reports[0].author, '\u0410\u0432\u0442\u043e\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d');
    });
  });

  await run('sorts report stage filters in the documented lifecycle order', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-stage-order-1');
      report.cards = [
        { ...report.cards[0], cardId: 'card-1', code: 'CARD-1', stage: '\u0412\u044b\u0441\u0430\u0434\u043a\u0430' },
        { ...report.cards[0], cardId: 'card-2', code: 'CARD-2', stage: '\u0422\u0435\u043f\u043b\u0438\u0446\u0430' },
        { ...report.cards[0], cardId: 'card-3', code: 'CARD-3', stage: '\u041a\u043b\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' },
        { ...report.cards[0], cardId: 'card-4', code: 'CARD-4', stage: '\u0410\u0434\u0430\u043f\u0442\u0430\u0446\u0438\u044f' },
        { ...report.cards[0], cardId: 'card-5', code: 'CARD-5', stage: '\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435 \u0432 \u043a\u0443\u043b\u044c\u0442\u0443\u0440\u0443' },
        { ...report.cards[0], cardId: 'card-6', code: 'CARD-6', stage: '\u0417\u0430\u043a\u0430\u043b\u043a\u0430' },
        { ...report.cards[0], cardId: 'card-7', code: 'CARD-7', stage: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u0441\u0442\u0430\u0434\u0438\u044f' }
      ];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'stage-order.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel();

      assert.deepEqual(viewModel.filterOptions.stages, [
        '\u0412\u0432\u0435\u0434\u0435\u043d\u0438\u0435 \u0432 \u043a\u0443\u043b\u044c\u0442\u0443\u0440\u0443',
        '\u041a\u043b\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',
        '\u0410\u0434\u0430\u043f\u0442\u0430\u0446\u0438\u044f',
        '\u0422\u0435\u043f\u043b\u0438\u0446\u0430',
        '\u0417\u0430\u043a\u0430\u043b\u043a\u0430',
        '\u0412\u044b\u0441\u0430\u0434\u043a\u0430',
        '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u0441\u0442\u0430\u0434\u0438\u044f'
      ]);
    });
  });

  await run('maps imported English stage names in report view model filters', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-stage-alias-view-model');

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'stage-alias-view-model.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ stage: '\u0422\u0435\u043f\u043b\u0438\u0446\u0430' });

      assert.deepEqual(viewModel.filterOptions.stages, ['\u0422\u0435\u043f\u043b\u0438\u0446\u0430']);
      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].stage, '\u0422\u0435\u043f\u043b\u0438\u0446\u0430');
    });
  });

  await run('uses top-level report author when user object is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-top-level-author-1');
      delete report.user;
      report.author = 'Anna Ivanova';

      await reportStore.processUploadedReport(buildZipFromReport(report), 'top-level-author.zip');
      const reports = await reportStore.listReports();
      const storedReport = await reportStore.getReport(reports[0].reportId);
      const viewModel = storedReport.buildViewModel();

      assert.equal(reports.length, 1);
      assert.equal(reports[0].author, 'Anna Ivanova');
      assert.equal(storedReport.author, 'Anna Ivanova');
      assert.equal(storedReport.cards[0].author, 'Anna Ivanova');
      assert.deepEqual(viewModel.filterOptions.authors, ['Anna Ivanova']);
    });
  });

  await run('keeps author-only reports with different top-level authors as separate imports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-top-level-author-a');
      const secondReport = buildValidReport('report-top-level-author-b');
      delete firstReport.user;
      delete secondReport.user;
      firstReport.author = 'Anna Ivanova';
      secondReport.author = 'Maria Petrova';

      const firstId = await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'top-level-author-a.zip');
      const secondId = await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'top-level-author-b.zip');
      const reports = await reportStore.listReports();

      assert.notEqual(firstId, secondId);
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((item) => item.author).sort(), ['Anna Ivanova', 'Maria Petrova']);
    });
  });

  await run('uses readable fallback event author when createdBy is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-no-created-by-1');
      delete report.user;
      delete report.cards[0].events[0].createdBy;

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'no-created-by.zip');
      const storedReport = await reportStore.getReport(reportId);

      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].createdBy, '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
    });
  });

  await run('uses top-level report author as fallback event author when createdBy is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-no-created-by-with-author-1');
      delete report.user;
      report.author = 'Anna Ivanova';
      delete report.cards[0].events[0].createdBy;

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'no-created-by-with-author.zip');
      const storedReport = await reportStore.getReport(reportId);

      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].createdBy, 'Anna Ivanova');
    });
  });

  await run('uses readable report employee name when stored event author contains a technical user identifier', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-userid-created-by-1');
      report.user.userId = 'demo-user-001';
      report.user.displayName = 'Anna Ivanova';
      report.cards[0].events[0].createdBy = 'demo-user-001';

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'userid-created-by.zip');
      const storedReport = await reportStore.getReport(reportId);

      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].createdBy, 'Anna Ivanova');
    });
  });

  await run('matches report card search by event createdBy', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-search-created-by-1');
      report.cards[0].events[0].createdBy = 'Maria Ivanova';

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'search-created-by.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ q: ' maria ' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].createdBy, 'Maria Ivanova');
    });
  });

  await run('matches report card search by event problemType and riskLevel', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-search-event-problemtype-1');
      report.cards[0].events = [{
        eventId: 'event-problem-search',
        type: 'observation',
        createdAt: '2026-07-30T10:05:00.000Z',
        problemType: 'Pest',
        riskLevel: 'High'
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'search-event-problemtype.zip');
      const storedReport = await reportStore.getReport(reportId);
      const problemViewModel = storedReport.buildViewModel({ q: ' pest ' });
      const riskViewModel = storedReport.buildViewModel({ q: ' high ' });

      assert.equal(problemViewModel.cards.length, 1);
      assert.equal(problemViewModel.cards[0].events[0].problemType, 'Pest');
      assert.equal(riskViewModel.cards.length, 1);
      assert.equal(riskViewModel.cards[0].events[0].riskLevel, 'High');
    });
  });

  await run('matches report card search by event title', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-search-event-title-1');
      report.cards[0].events = [{
        eventId: 'event-title-search',
        type: 'observation',
        title: 'Emergency transplant',
        createdAt: '2026-07-30T10:05:00.000Z'
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'search-event-title.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ q: ' transplant ' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].title, 'Emergency transplant');
    });
  });

  await run('matches report card date filter by any event date, not only the first event', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-event-date-1');
      report.cards[0].createdAt = '2026-07-28T10:00:00.000Z';
      report.cards[0].events = [
        {
          eventId: 'event-older',
          type: 'greenhouseCare',
          createdAt: '2026-07-29T10:00:00.000Z',
          createdBy: 'user-1'
        },
        {
          eventId: 'event-newer',
          type: 'sale',
          createdAt: '2026-07-30T10:00:00.000Z',
          createdBy: 'user-1'
        }
      ];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-event-date.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ date: '2026-07-30' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[1].eventId, 'event-newer');
    });
  });

  await run('matches report hasProblems filter by event problemType and riskLevel', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-event-problemtype-1');
      report.cards[0].batchStatus = 'active';
      report.cards[0].events = [{
        eventId: 'event-problem',
        type: 'observation',
        createdAt: '2026-07-30T10:05:00.000Z',
        problemType: 'Pest',
        riskLevel: 'High'
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-event-problemtype.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasProblems: '1' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].problemType, 'Pest');
      assert.equal(viewModel.cards[0].events[0].riskLevel, 'High');
    });
  });

  await run('matches report hasProblems filter by event extraFields problemType and riskLevel', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-event-problem-extra-1');
      report.cards[0].batchStatus = 'active';
      report.cards[0].events = [{
        eventId: 'event-problem-extra',
        type: 'observation',
        createdAt: '2026-07-30T10:05:00.000Z',
        extraFields: {
          problemType: 'Pest',
          riskLevel: 'High'
        }
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-event-problem-extra.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasProblems: '1' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].problemType, 'Pest');
      assert.equal(viewModel.cards[0].events[0].riskLevel, 'High');
    });
  });

  await run('matches report hasProblems filter by card extraFields problemType and riskLevel', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-card-problem-extra-1');
      report.cards[0].batchStatus = 'active';
      report.cards[0].problem = '';
      report.cards[0].problemType = '';
      report.cards[0].risk = '';
      report.cards[0].riskLevel = '';
      report.cards[0].extraFields = {
        problemType: 'Pest',
        riskLevel: 'High'
      };

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-card-problem-extra.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasProblems: '1' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].problemType, 'Pest');
      assert.equal(viewModel.cards[0].riskLevel, 'High');
    });
  });

  await run('matches report hasProblems filter by problem events without explicit problem fields', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-problem-event-type-1');
      report.summary = {};
      report.cards[0].batchStatus = 'active';
      report.cards[0].events = [{
        eventId: 'event-problem-type',
        type: 'problem',
        createdAt: '2026-07-30T10:05:00.000Z',
        comment: 'Visible contamination spot'
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-problem-event-type.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasProblems: '1' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].type, 'problem');
      assert.equal(storedReport.summary.problemsCount, 1);
    });
  });

  await run('matches report hasProblems filter by event problemDescription without explicit problem type', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-filter-problem-description-1');
      report.summary = {};
      report.cards[0].batchStatus = 'active';
      report.cards[0].events = [{
        eventId: 'event-problem-description',
        type: 'observation',
        createdAt: '2026-07-30T10:05:00.000Z',
        extraFields: {
          problemDescription: 'Visible contamination spot'
        }
      }];

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'filter-problem-description.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasProblems: '1' });

      assert.equal(viewModel.cards.length, 1);
      assert.equal(viewModel.cards[0].events[0].extraFields.problemDescription, 'Visible contamination spot');
      assert.equal(storedReport.summary.problemsCount, 1);
    });
  });

  await run('hides technical missing plant names in stored report cards and filter options', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-hidden-plant-name-1');
      report.cards[0].cultureName = 'РђСЂРѕРЅРёСЏ';
      report.cards[0].speciesName = '\u041c\u0443\u043b\u0430\u0442\u043a\u0430';
      report.cards[0].varietyName = '\u041e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442';

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'hidden-plant-name.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel();

      assert.equal(storedReport.cards[0].culture, 'РђСЂРѕРЅРёСЏ');
      assert.equal(storedReport.cards[0].sort, '\u041c\u0443\u043b\u0430\u0442\u043a\u0430');
      assert.equal(storedReport.cards[0].variety, '');
      assert.deepEqual(viewModel.filterOptions.cultures, ['РђСЂРѕРЅРёСЏ']);
    });
  });

  await run('preserves event photo files from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-photos-1');
      const secondReport = buildValidReport('report-merged-event-photos-1');

      firstReport.cards[0].events[0].photoFiles = ['photos/event-first.jpg'];
      secondReport.cards[0].events[0].photoFiles = ['photos/event-second.jpg'];

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/event-first.jpg',
          data: Buffer.from('event-first-image')
        }]),
        'merged-event-photos-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/event-second.jpg',
          data: Buffer.from('event-second-image')
        }]),
        'merged-event-photos-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].events[0].photos.slice().sort(),
        ['photos/event-first.jpg', 'photos/event-second.jpg']
      );
    });
  });

  await run('preserves event extra fields from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-extra-fields-1');
      const secondReport = buildValidReport('report-merged-event-extra-fields-1');

      firstReport.cards[0].events[0].extraFields = {
        stressLevel: 'РќРёР·РєРёР№'
      };
      secondReport.cards[0].events[0].extraFields = {
        turgor: 'РќРѕСЂРјР°Р»СЊРЅС‹Р№'
      };

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-event-extra-fields-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-event-extra-fields-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(storedReport.cards[0].events[0].extraFields, {
        stressLevel: 'РќРёР·РєРёР№',
        turgor: 'РќРѕСЂРјР°Р»СЊРЅС‹Р№'
      });
    });
  });

  await run('preserves event photo uri aliases from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-photo-uris-1');
      const secondReport = buildValidReport('report-merged-event-photo-uris-1');

      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].events[0].photoUri = 'photos/event-alias-first.jpg';
      secondReport.cards[0].events[0].photoUris = ['photos/event-alias-second.jpg'];

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/event-alias-first.jpg',
          data: Buffer.from('event-alias-first-image')
        }]),
        'merged-event-photo-uris-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/event-alias-second.jpg',
          data: Buffer.from('event-alias-second-image')
        }]),
        'merged-event-photo-uris-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].events[0].photos.slice().sort(),
        ['photos/event-alias-first.jpg', 'photos/event-alias-second.jpg']
      );
    });
  });

  await run('preserves card photo uri aliases from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-card-photo-uris-1');
      const secondReport = buildValidReport('report-merged-card-photo-uris-1');

      delete firstReport.cards[0].photoFiles;
      delete secondReport.cards[0].photoFiles;
      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].photoUri = 'photos/card-alias-first.jpg';
      secondReport.cards[0].photoUris = ['photos/card-alias-second.jpg'];

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/card-alias-first.jpg',
          data: Buffer.from('card-alias-first-image')
        }]),
        'merged-card-photo-uris-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/card-alias-second.jpg',
          data: Buffer.from('card-alias-second-image')
        }]),
        'merged-card-photo-uris-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        ['photos/card-alias-first.jpg', 'photos/card-alias-second.jpg']
      );
    });
  });

  await run('preserves event photoUris arrays from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-photo-uri-arrays-1');
      const secondReport = buildValidReport('report-merged-event-photo-uri-arrays-1');

      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].events[0].photoUris = ['photos/event-array-first.jpg'];
      secondReport.cards[0].events[0].photoUris = ['photos/event-array-second.jpg'];

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/event-array-first.jpg',
          data: Buffer.from('event-array-first-image')
        }]),
        'merged-event-photo-uri-arrays-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/event-array-second.jpg',
          data: Buffer.from('event-array-second-image')
        }]),
        'merged-event-photo-uri-arrays-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].events[0].photos.slice().sort(),
        ['photos/event-array-first.jpg', 'photos/event-array-second.jpg']
      );
    });
  });

  await run('preserves repeated scalar event photoUri aliases from the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-photo-uri-scalars-1');
      const secondReport = buildValidReport('report-merged-event-photo-uri-scalars-1');

      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].events[0].photoUri = 'photos/event-scalar-first.jpg';
      secondReport.cards[0].events[0].photoUri = 'photos/event-scalar-second.jpg';

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/event-scalar-first.jpg',
          data: Buffer.from('event-scalar-first-image')
        }]),
        'merged-event-photo-uri-scalars-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/event-scalar-second.jpg',
          data: Buffer.from('event-scalar-second-image')
        }]),
        'merged-event-photo-uri-scalars-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].events[0].photos.slice().sort(),
        ['photos/event-scalar-first.jpg', 'photos/event-scalar-second.jpg']
      );
    });
  });

  await run('preserves repeated scalar card photoUri aliases from the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-card-photo-uri-scalars-1');
      const secondReport = buildValidReport('report-merged-card-photo-uri-scalars-1');

      delete firstReport.cards[0].photoFiles;
      delete secondReport.cards[0].photoFiles;
      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].photoUri = 'photos/card-scalar-first.jpg';
      secondReport.cards[0].photoUri = 'photos/card-scalar-second.jpg';

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{
          name: 'photos/card-scalar-first.jpg',
          data: Buffer.from('card-scalar-first-image')
        }]),
        'merged-card-photo-uri-scalars-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{
          name: 'photos/card-scalar-second.jpg',
          data: Buffer.from('card-scalar-second-image')
        }]),
        'merged-card-photo-uri-scalars-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        ['photos/card-scalar-first.jpg', 'photos/card-scalar-second.jpg']
      );
    });
  });

  await run('preserves readable report author metadata when repeated import contains only blank author fields', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-author-1');
      const secondReport = buildValidReport('report-merged-author-1');

      delete firstReport.user;
      delete secondReport.user;
      firstReport.author = 'Anna Ivanova';
      secondReport.author = '   ';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-author-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-author-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);
      assert.equal(reports[0].author, 'Anna Ivanova');

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.author, 'Anna Ivanova');
      assert.equal(storedReport.cards[0].author, 'Anna Ivanova');
    });
  });

  await run('preserves summary counts when repeated import contains only blank summary values', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-summary-1');
      const secondReport = buildValidReport('report-merged-summary-1');

      secondReport.summary = {
        cardsCount: '   ',
        eventsCount: '   ',
        photosCount: '   ',
        problemsCount: '   ',
        activeCount: '   ',
        soldCount: '   '
      };

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-summary-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-summary-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);
      assert.equal(reports[0].summary.cardsCount, 1);
      assert.equal(reports[0].summary.eventsCount, 1);
      assert.equal(reports[0].summary.activeCount, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.summary.cardsCount, 1);
      assert.equal(storedReport.summary.eventsCount, 1);
      assert.equal(storedReport.summary.activeCount, 1);
    });
  });

  await run('derives consistent problem summary counts when report summary is missing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-derived-problem-count-1');
      delete report.summary;
      report.cards[0].batchStatus = 'problem';

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'derived-problem-count.zip');
      const reports = await reportStore.listReports();

      assert.equal(reports.length, 1);
      assert.equal(reports[0].summary.problemsCount, 1);
      assert.equal(reports[0].summary.problemCount, 1);

      const storedReport = await reportStore.getReport(reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.summary.problemsCount, 1);
      assert.equal(storedReport.summary.problemCount, 1);
    });
  });

  await run('supports singular photoPath aliases for card and event photos during import', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-singular-photo-path-1');

      delete report.cards[0].photoFiles;
      delete report.cards[0].events[0].photoFiles;
      report.cards[0].photoPath = 'photos/card-singular-path.jpg';
      report.cards[0].events[0].photoPath = 'photos/event-singular-path.jpg';

      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(report, [
          {
            name: 'photos/card-singular-path.jpg',
            data: Buffer.from('card-singular-path-image')
          },
          {
            name: 'photos/event-singular-path.jpg',
            data: Buffer.from('event-singular-path-image')
          }
        ]),
        'singular-photo-path.zip'
      );

      const storedReport = await reportStore.getReport(reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        ['photos/card-singular-path.jpg', 'photos/event-singular-path.jpg']
      );
      assert.deepEqual(storedReport.cards[0].events[0].photos, ['photos/event-singular-path.jpg']);
    });
  });

  await run('supports object photoPath aliases for card and event photos during import', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-object-photo-path-1');

      delete report.cards[0].photoFiles;
      delete report.cards[0].events[0].photoFiles;
      report.cards[0].photos = [{ photoPath: 'photos/card-object-path.jpg' }];
      report.cards[0].events[0].photos = [{ photoPath: 'photos/event-object-path.jpg' }];

      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(report, [
          {
            name: 'photos/card-object-path.jpg',
            data: Buffer.from('card-object-path-image')
          },
          {
            name: 'photos/event-object-path.jpg',
            data: Buffer.from('event-object-path-image')
          }
        ]),
        'object-photo-path.zip'
      );

      const storedReport = await reportStore.getReport(reportId);
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        ['photos/card-object-path.jpg', 'photos/event-object-path.jpg']
      );
      assert.deepEqual(storedReport.cards[0].events[0].photos, ['photos/event-object-path.jpg']);
    });
  });

  await run('keeps external photoUri urls for card and event photos during import', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-external-photo-uri-1');

      report.cards[0].photoFiles = [];
      report.cards[0].photoUri = 'https://cdn.example.com/card-photo.jpg';
      report.cards[0].events[0].photoFiles = [];
      report.cards[0].events[0].photoUri = 'https://cdn.example.com/event-photo.jpg';

      const reportId = await reportStore.processUploadedReport(buildZipFromReport(report), 'external-photo-uri.zip');
      const storedReport = await reportStore.getReport(reportId);
      const viewModel = storedReport.buildViewModel({ hasPhotos: '1' });

      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        ['https://cdn.example.com/card-photo.jpg', 'https://cdn.example.com/event-photo.jpg']
      );
      assert.deepEqual(storedReport.cards[0].events[0].photos, ['https://cdn.example.com/event-photo.jpg']);
      assert.equal(viewModel.cards.length, 1);
    });
  });

  await run('preserves object photoPath aliases from repeated imports of the same report', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-object-photos-1');
      const secondReport = buildValidReport('report-merged-object-photos-1');

      delete firstReport.cards[0].photoFiles;
      delete firstReport.cards[0].events[0].photoFiles;
      delete secondReport.cards[0].photoFiles;
      delete secondReport.cards[0].events[0].photoFiles;
      firstReport.cards[0].photos = [{ photoPath: 'photos/card-object-first.jpg' }];
      firstReport.cards[0].events[0].photos = [{ photoPath: 'photos/event-object-first.jpg' }];
      secondReport.cards[0].photos = [{ photoPath: 'photos/card-object-second.jpg' }];
      secondReport.cards[0].events[0].photos = [{ photoPath: 'photos/event-object-second.jpg' }];

      await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [
          {
            name: 'photos/card-object-first.jpg',
            data: Buffer.from('card-object-first-image')
          },
          {
            name: 'photos/event-object-first.jpg',
            data: Buffer.from('event-object-first-image')
          }
        ]),
        'merged-object-photos-a.zip'
      );

      await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [
          {
            name: 'photos/card-object-second.jpg',
            data: Buffer.from('card-object-second-image')
          },
          {
            name: 'photos/event-object-second.jpg',
            data: Buffer.from('event-object-second-image')
          }
        ]),
        'merged-object-photos-b.zip'
      );

      const storedReport = await reportStore.getReport('report-merged-object-photos-1');
      assert.ok(storedReport);
      assert.deepEqual(
        storedReport.cards[0].photos.slice().sort(),
        [
          'photos/card-object-first.jpg',
          'photos/card-object-second.jpg',
          'photos/event-object-first.jpg',
          'photos/event-object-second.jpg'
        ]
      );
      assert.deepEqual(
        storedReport.cards[0].events[0].photos.slice().sort(),
        ['photos/event-object-first.jpg', 'photos/event-object-second.jpg']
      );
    });
  });

  await run('preserves event text fields when repeated import contains only blank event values', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-text-1');
      const secondReport = buildValidReport('report-merged-event-text-1');

      firstReport.cards[0].events[0].comment = '\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u044b\u0439 \u0440\u043e\u0441\u0442';
      firstReport.cards[0].events[0].title = '\u041e\u0441\u043c\u043e\u0442\u0440';
      secondReport.cards[0].events[0].comment = '   ';
      secondReport.cards[0].events[0].title = '   ';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-event-text-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-event-text-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].comment, '\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u044b\u0439 \u0440\u043e\u0441\u0442');
      assert.equal(storedReport.cards[0].events[0].title, '\u041e\u0441\u043c\u043e\u0442\u0440');
    });
  });

  await run('does not leak supported card photo alias fields into extraFields', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const report = buildValidReport('report-card-photo-alias-extras-1');

      delete report.cards[0].photoFiles;
      report.cards[0].photoUri = 'photos/card-extra-alias.jpg';
      report.cards[0].photoUris = ['photos/card-extra-alias-2.jpg'];
      report.cards[0].startPhotoUri = 'photos/card-start-extra-alias.jpg';
      report.cards[0].startPhotoUris = ['photos/card-start-extra-alias-2.jpg'];

      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(report, [
          { name: 'photos/card-extra-alias.jpg', data: Buffer.from('a') },
          { name: 'photos/card-extra-alias-2.jpg', data: Buffer.from('b') },
          { name: 'photos/card-start-extra-alias.jpg', data: Buffer.from('c') },
          { name: 'photos/card-start-extra-alias-2.jpg', data: Buffer.from('d') }
        ]),
        'card-photo-alias-extras.zip'
      );

      const storedReport = await reportStore.getReport(reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].extraFields.photoUri, undefined);
      assert.equal(storedReport.cards[0].extraFields.photoUris, undefined);
      assert.equal(storedReport.cards[0].extraFields.startPhotoUri, undefined);
      assert.equal(storedReport.cards[0].extraFields.startPhotoUris, undefined);
    });
  });

  await run('preserves event extra field values when repeated import contains only blank extra field text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-extra-field-text-1');
      const secondReport = buildValidReport('report-merged-event-extra-field-text-1');

      firstReport.cards[0].events[0].extraFields = { problemDescription: '\u041d\u0443\u0436\u0435\u043d \u043e\u0441\u043c\u043e\u0442\u0440' };
      secondReport.cards[0].events[0].extraFields = { problemDescription: '   ' };

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-event-extra-field-text-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-event-extra-field-text-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].extraFields.problemDescription, '\u041d\u0443\u0436\u0435\u043d \u043e\u0441\u043c\u043e\u0442\u0440');
    });
  });

  await run('preserves nested event extra field values when repeated import contains blank nested text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-event-nested-extra-1');
      const secondReport = buildValidReport('report-merged-event-nested-extra-1');

      firstReport.cards[0].events[0].extraFields = {
        climate: {
          temp: '22',
          humidity: '61'
        }
      };
      secondReport.cards[0].events[0].extraFields = {
        climate: {
          temp: '   ',
          humidity: '64'
        }
      };

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-event-nested-extra-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-event-nested-extra-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.deepEqual(storedReport.cards[0].events[0].extraFields.climate, {
        temp: '22',
        humidity: '64'
      });
    });
  });

  await run('preserves card extra field values when repeated import contains only blank extra field text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-card-extra-field-text-1');
      const secondReport = buildValidReport('report-merged-card-extra-field-text-1');

      firstReport.cards[0].extraFields = { benchLabel: '\u0421\u0442\u0435\u043b\u043b\u0430\u0436 \u0410' };
      secondReport.cards[0].extraFields = { benchLabel: '   ' };

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-card-extra-field-text-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-card-extra-field-text-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].extraFields.benchLabel, '\u0421\u0442\u0435\u043b\u043b\u0430\u0436 \u0410');
    });
  });

  await run('preserves root event extra field values when repeated import contains only blank text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-root-event-extra-field-text-1');
      const secondReport = buildValidReport('report-merged-root-event-extra-field-text-1');

      firstReport.cards[0].events[0].problemDescription = 'Needs review';
      secondReport.cards[0].events[0].problemDescription = '   ';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-root-event-extra-field-text-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-root-event-extra-field-text-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].events[0].extraFields.problemDescription, 'Needs review');
    });
  });

  await run('preserves root card extra field values when repeated import contains only blank text', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-merged-root-card-extra-field-text-1');
      const secondReport = buildValidReport('report-merged-root-card-extra-field-text-1');

      firstReport.cards[0].benchLabel = 'Rack A';
      secondReport.cards[0].benchLabel = '   ';

      await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'merged-root-card-extra-field-text-a.zip');
      await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'merged-root-card-extra-field-text-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 1);

      const storedReport = await reportStore.getReport(reports[0].reportId);
      assert.ok(storedReport);
      assert.equal(storedReport.cards[0].extraFields.benchLabel, 'Rack A');
    });
  });

  await run('keeps reports with different event extra fields as separate imports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-fingerprint-event-extra-a');
      const secondReport = buildValidReport('report-fingerprint-event-extra-b');

      firstReport.cards[0].events[0].extraFields = { problemDescription: 'Alpha' };
      secondReport.cards[0].events[0].extraFields = { problemDescription: 'Beta' };

      const firstId = await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'fingerprint-event-extra-a.zip');
      const secondId = await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'fingerprint-event-extra-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(firstId, 'report-fingerprint-event-extra-a');
      assert.equal(secondId, 'report-fingerprint-event-extra-b');
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((item) => item.reportId).sort(), ['report-fingerprint-event-extra-a', 'report-fingerprint-event-extra-b']);
    });
  });

  await run('keeps reports with different card problem fields as separate imports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-fingerprint-card-problem-a');
      const secondReport = buildValidReport('report-fingerprint-card-problem-b');

      firstReport.cards[0].problem = 'Pest';
      secondReport.cards[0].problem = 'Fungus';

      const firstId = await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'fingerprint-card-problem-a.zip');
      const secondId = await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'fingerprint-card-problem-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(firstId, 'report-fingerprint-card-problem-a');
      assert.equal(secondId, 'report-fingerprint-card-problem-b');
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((item) => item.reportId).sort(), ['report-fingerprint-card-problem-a', 'report-fingerprint-card-problem-b']);
    });
  });

  await run('keeps reports with different card photo paths as separate imports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-fingerprint-card-photo-a');
      const secondReport = buildValidReport('report-fingerprint-card-photo-b');

      firstReport.cards[0].photoUri = 'photos/card-photo-a.jpg';
      secondReport.cards[0].photoUri = 'photos/card-photo-b.jpg';

      const firstId = await reportStore.processUploadedReport(
        buildZipFromReport(firstReport, [{ name: 'photos/card-photo-a.jpg', data: Buffer.from('photo-a') }]),
        'fingerprint-card-photo-a.zip'
      );
      const secondId = await reportStore.processUploadedReport(
        buildZipFromReport(secondReport, [{ name: 'photos/card-photo-b.jpg', data: Buffer.from('photo-b') }]),
        'fingerprint-card-photo-b.zip'
      );

      const reports = await reportStore.listReports();
      assert.equal(firstId, 'report-fingerprint-card-photo-a');
      assert.equal(secondId, 'report-fingerprint-card-photo-b');
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((item) => item.reportId).sort(), ['report-fingerprint-card-photo-a', 'report-fingerprint-card-photo-b']);
    });
  });

  await run('keeps identical reports with different reportIds as separate imports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport('report-fingerprint-identical-a');
      const secondReport = buildValidReport('report-fingerprint-identical-b');

      const firstId = await reportStore.processUploadedReport(buildZipFromReport(firstReport), 'fingerprint-identical-a.zip');
      const secondId = await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'fingerprint-identical-b.zip');

      const reports = await reportStore.listReports();
      assert.equal(firstId, 'report-fingerprint-identical-a');
      assert.equal(secondId, 'report-fingerprint-identical-b');
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((item) => item.reportId).sort(), ['report-fingerprint-identical-a', 'report-fingerprint-identical-b']);
    });
  });

  await run('returns upload page with 400 when too many files are posted', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const files = Array.from({ length: 21 }, (_, index) => ({
          name: 'reportZip',
          filename: `report-${index + 1}.zip`,
          contentType: 'application/zip',
          data: buildZipFromReport(buildValidReport(`report-http-${index + 1}`))
        }));

        const response = await requestMultipart(server, '/upload', files);
        const body = response.body.toString('utf8');

        assert.equal(response.statusCode, 400);
        assert.match(body, /\u0417\u0430 \u043e\u0434\u0438\u043d \u0440\u0430\u0437 \u043c\u043e\u0436\u043d\u043e \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 20 ZIP-\u0430\u0440\u0445\u0438\u0432\u043e\u0432/);
        assert.match(body, /class="upload-form upload-form-home"/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps upload page as the primary route on upload errors when there are no reports yet', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await requestWithBody(
          server,
          'POST',
          '/upload',
          Buffer.from(''),
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );
        const body = response.body.toString('utf8');

        assert.equal(response.statusCode, 400);
        assert.match(body, /class="alert alert-error upload-error">/);
        assert.match(body, /class="upload-form upload-form-home"/);
        assert.doesNotMatch(body, /class="sidebar-item active" href="\/">[\s\S]*<span>Р“Р»Р°РІРЅР°СЏ<\/span>/);
        assert.match(body, /class="button button-secondary upload-back-button">/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('rejects corrupted zip archives with a safe user message', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);

      await assert.rejects(
        reportStore.processUploadedReport(Buffer.from('not-a-zip'), 'broken.zip'),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.equal(error.userMessage, 'ZIP-архив поврежден или имеет неверный формат.');
          assert.equal(error.internalCode, 'INVALID_ZIP_ARCHIVE');
          return true;
        }
      );
    });
  });

  await run('rejects invalid report.json with a safe user message', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const zip = createZip([
        {
          name: 'report.json',
          data: '{"reportId":'
        },
        {
          name: 'photos/card.jpg',
          data: Buffer.from('fake-image')
        }
      ]);

      await assert.rejects(
        reportStore.processUploadedReport(zip, 'invalid-json.zip'),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.equal(error.userMessage, '\u0424\u0430\u0439\u043b report.json \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043d\u0435\u0432\u0430\u043b\u0438\u0434\u043d\u044b\u0439 JSON.');
          assert.equal(error.internalCode, 'INVALID_REPORT_JSON');
          return true;
        }
      );
    });
  });

  await run('imports a valid archive and serves photos through controlled route', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport()), 'report.zip');
      const report = await reportStore.getReport(reportId);
      assert.ok(report);
      assert.equal(report.getPhotoUrl('photos/card.jpg'), `/reports/${reportId}/photos/card.jpg`);

      const server = await startServer(createApp());
      try {
        const photoResponse = await request(server, `/reports/${reportId}/photos/card.jpg`);
        assert.equal(photoResponse.statusCode, 200);
        assert.equal(photoResponse.body.toString('utf8'), 'fake-image');

        const legacyResponse = await request(server, `/storage/reports/${reportId}/photos/card.jpg`);
        assert.equal(legacyResponse.statusCode, 404);
      } finally {
        server.close();
      }
    });
  });

  await run('shows error page as the primary route when a report is missing and no reports exist yet', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const server = await startServer(createApp());
      try {
        const response = await request(server, '/reports/missing-report');
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.match(body, /\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442\./);
        assert.match(body, /\u041d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e/);
        assert.match(body, /<a class="sidebar-item active" href="\/">/);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.doesNotMatch(body, /РќР° РґР°С€Р±РѕСЂРґ/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('shows a safe 404 page when a direct report is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(buildValidReport('report-direct-corrupted-1')),
        'direct-corrupted.zip'
      );
      await fs.writeFile(path.join(dataDir, 'reports', reportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.match(body, /<h1>Отчет не найден<\/h1>/);
        assert.match(body, /<p>\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442\.<\/p>/);
        assert.match(body, /\u041d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e/);
        assert.match(body, /<a class="sidebar-item active" href="\/">/);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.doesNotMatch(body, /\u041d\u0430 \u0434\u0430\u0448\u0431\u043e\u0440\u0434/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('blocks direct photo access when a report is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(buildValidReport('report-direct-corrupted-photo-1')),
        'direct-corrupted-photo.zip'
      );
      await fs.writeFile(path.join(dataDir, 'reports', reportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/photos/card.jpg`);
        assert.equal(response.statusCode, 404);
      } finally {
        server.close();
      }
    });
  });

  await run('blocks direct raw access when a report is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(buildValidReport('report-direct-corrupted-raw-1')),
        'direct-corrupted-raw.zip'
      );
      await fs.writeFile(path.join(dataDir, 'reports', reportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/raw`);
        assert.equal(response.statusCode, 404);
      } finally {
        server.close();
      }
    });
  });

  await run('blocks direct zip access when a report is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(buildValidReport('report-direct-corrupted-zip-1')),
        'direct-corrupted-zip.zip'
      );
      await fs.writeFile(path.join(dataDir, 'reports', reportId, 'report.json'), '{"reportId":', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/zip`);
        assert.equal(response.statusCode, 404);
      } finally {
        server.close();
      }
    });
  });

  await run('rejects invalid direct reportId route values instead of sanitizing them', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report')), 'strict-route-id.zip');

      const server = await startServer(createApp());
      try {
        const invalidRoutes = [
          '/reports/%2e%2e',
          '/reports/report%5Cevil',
          `/reports/${'a'.repeat(181)}`,
          '/reports/%2e%2e/raw',
          '/reports/%2e%2e/zip',
          '/reports/%2e%2e/photos/card.jpg'
        ];

        for (const route of invalidRoutes) {
          const response = await request(server, route);
          const body = response.body.toString('utf8');
          assert.equal(response.statusCode, 404);
          assert.doesNotMatch(body, /href="\/reports\/report"/);
          assert.match(body, /\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442\.|<div class="empty-state">/);
        }
      } finally {
        server.close();
      }
    });
  });

  await run('blocks hidden report photos through the dedicated route', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-hidden-1')), 'hidden.zip');
      const reportsDir = path.join(dataDir, 'reports');
      await fs.writeFile(path.join(reportsDir, '.hidden-report-ids.json'), `${JSON.stringify([reportId])}\n`, 'utf8');

      const server = await startServer(createApp());
      try {
        const photoResponse = await request(server, `/reports/${reportId}/photos/card.jpg`);
        const body = photoResponse.body.toString('utf8');
        assert.equal(photoResponse.statusCode, 404);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.match(body, /\u0417\u0430\u043f\u0440\u043e\u0448\u0435\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u0441\u043a\u0440\u044b\u0442\./);
        assert.match(body, /\u041d\u0430 \u0433\u043b\u0430\u0432\u043d\u0443\u044e/);
      } finally {
        server.close();
      }
    });
  });

  await run('blocks hidden reports through direct page and download routes', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-hidden-direct-1')), 'hidden-direct.zip');
      const reportsDir = path.join(dataDir, 'reports');
      await fs.writeFile(path.join(reportsDir, '.hidden-report-ids.json'), `${JSON.stringify([reportId])}\n`, 'utf8');

      const server = await startServer(createApp());
      try {
        for (const route of [`/reports/${reportId}`, `/reports/${reportId}/raw`, `/reports/${reportId}/zip`]) {
          const response = await request(server, route);
          const body = response.body.toString('utf8');
          assert.equal(response.statusCode, 404);
          assert.doesNotMatch(body, /sidebar-clear-form/);
          assert.match(body, /\u0417\u0430\u043f\u0440\u043e\u0448\u0435\u043d\u043d\u044b\u0439 \u043e\u0442\u0447\u0435\u0442 \u0441\u043a\u0440\u044b\u0442\./);
        }
      } finally {
        server.close();
      }
    });
  });

  await run('returns 404 when original.zip path is a directory', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const reportId = 'report-download-dir-1';
      const reportDir = path.join(dataDir, 'reports', reportId);
      await fs.mkdir(path.join(reportDir, 'original.zip'), { recursive: true });
      await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(buildValidReport(reportId), null, 2)}\n`, 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/zip`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.match(body, /sidebar-clear-form/);
        assert.match(body, /\u0417\u0430\u043f\u0440\u043e\u0448\u0435\u043d\u043d\u044b\u0439 \u0444\u0430\u0439\u043b \u043e\u0442\u0447\u0435\u0442\u0430 \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442\./);
        assert.match(body, /\u041d\u0430 \u0434\u0430\u0448\u0431\u043e\u0440\u0434/);
        assert.match(body, /<a class="sidebar-item active" href="\/">/);
      } finally {
        server.close();
      }
    });
  });

  await run('returns 404 when report.json path is a directory', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const reportId = 'report-raw-dir-1';
      const reportDir = path.join(dataDir, 'reports', reportId);
      await fs.mkdir(path.join(reportDir, 'report.json'), { recursive: true });

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/raw`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.match(body, /<div class="empty-state">/);
        assert.match(body, /<a href="\/" class="button">/);
      } finally {
        server.close();
      }
    });
  });

  await run('returns 404 when requested photo path points to a directory', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const reportId = 'report-photo-dir-1';
      const reportDir = path.join(dataDir, 'reports', reportId);
      await fs.mkdir(path.join(reportDir, 'photos', 'nested'), { recursive: true });
      await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(buildValidReport(reportId), null, 2)}\n`, 'utf8');
      await fs.writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify({ cardsCount: 1 }, null, 2)}\n`, 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/photos/nested`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.match(body, /sidebar-clear-form/);
        assert.match(body, /<div class="empty-state">/);
        assert.match(body, /<a href="\/" class="button">/);
      } finally {
        server.close();
      }
    });
  });

  await run('returns 404 when requested photo path tries to escape the report directory', async () => {
    await withTempDir(async (dataDir) => {
      const { createApp } = loadModules(dataDir);
      const reportId = 'report-photo-traversal-1';
      const reportDir = path.join(dataDir, 'reports', reportId);
      await fs.mkdir(path.join(reportDir, 'photos'), { recursive: true });
      await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(buildValidReport(reportId), null, 2)}\n`, 'utf8');
      await fs.writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify({ cardsCount: 1 }, null, 2)}\n`, 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}/photos/../report.json`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 404);
        assert.match(body, /sidebar-clear-form/);
        assert.match(body, /<div class="empty-state">/);
        assert.match(body, /<a href="\/" class="button">/);
      } finally {
        server.close();
      }
    });
  });

  await run('rejects reports without cards array', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const zip = createZip([{
        name: 'report.json',
        data: JSON.stringify({
          reportId: 'broken-report',
          createdAt: '2026-07-30T10:00:00.000Z'
        })
      }]);

      await assert.rejects(
        reportStore.processUploadedReport(zip, 'broken.zip'),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.equal(error.userMessage, '\u041e\u0442\u0447\u0435\u0442 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u0443\u044e \u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443: cards \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u043c\u0430\u0441\u0441\u0438\u0432\u043e\u043c.');
          return true;
        }
      );
    });
  });

  await run('rejects archive path traversal entries', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const zip = createZip([
        {
          name: 'report.json',
          data: JSON.stringify(buildValidReport('report-traversal-1'))
        },
        {
          name: 'photos/../report.json',
          data: 'evil'
        }
      ]);

      await assert.rejects(
        reportStore.processUploadedReport(zip, 'traversal.zip'),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.equal(error.userMessage, '\u0410\u0440\u0445\u0438\u0432 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043d\u0435\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0439 \u043f\u0443\u0442\u044c \u043a \u0444\u0430\u0439\u043b\u0443.');
          return true;
        }
      );

      const reportDir = path.join(dataDir, 'reports', 'report-traversal-1');
      const exists = await fs.access(reportDir).then(() => true).catch(() => false);
      assert.equal(exists, false);
    });
  });

  await run('rejects duplicate archive paths with different case', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const zip = buildZipFromReport(buildValidReport('report-duplicate-1'), [{
        name: 'photos/CARD.jpg',
        data: Buffer.from('duplicate-image')
      }]);

      await assert.rejects(
        reportStore.processUploadedReport(zip, 'duplicate.zip'),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.equal(error.userMessage, '\u0410\u0440\u0445\u0438\u0432 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u0434\u0443\u0431\u043b\u0438\u0440\u0443\u044e\u0449\u0438\u0435\u0441\u044f \u043f\u0443\u0442\u0438 \u0444\u0430\u0439\u043b\u043e\u0432.');
          return true;
        }
      );
    });
  });

  await run('rejects entries that exceed configured unzip limits', async () => {
    await withTempDir(async (dataDir) => {
      process.env.SADOVNIK_MAX_ZIP_ENTRY_BYTES = '5';
      try {
        const { reportStore } = loadModules(dataDir);
        const zip = buildZipFromReport(buildValidReport('report-large-entry-1'), [{
          name: 'photos/large.jpg',
          data: Buffer.from('123456')
        }]);

        await assert.rejects(
          reportStore.processUploadedReport(zip, 'large.zip'),
          (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.userMessage, '\u0410\u0440\u0445\u0438\u0432 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439 \u0444\u0430\u0439\u043b.');
            return true;
          }
        );
      } finally {
        delete process.env.SADOVNIK_MAX_ZIP_ENTRY_BYTES;
      }
    });
  });

  await run('avoids fallback reportId collisions for archives without reportId', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const firstReport = buildValidReport();
      const secondReport = buildValidReport();
      delete firstReport.reportId;
      delete secondReport.reportId;
      secondReport.createdAt = '2026-07-30T11:00:00.000Z';
      const firstId = await reportStore.processUploadedReport(buildZipFromReport(firstReport), '\u043e\u0442\u0447\u0435\u0442.zip');
      const secondId = await reportStore.processUploadedReport(buildZipFromReport(secondReport), 'Р°СЂС…РёРІ.zip');

      assert.notEqual(firstId, secondId);
      assert.match(firstId, /^report-[a-f0-9]{8}$/);
      assert.match(secondId, /^report-[a-f0-9]{8}$/);

      const reports = await reportStore.listReports();
      assert.equal(reports.length, 2);
    });
  });

  await run('warns and skips corrupted report directories during listing', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-valid-1')), 'valid.zip');
      const brokenDir = path.join(dataDir, 'reports', 'broken-report');
      await fs.mkdir(brokenDir, { recursive: true });
      await fs.writeFile(path.join(brokenDir, 'report.json'), '{"cards": "bad"}', 'utf8');

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message) => warnings.push(String(message));
      try {
        const reports = await reportStore.listReports();
        assert.equal(reports.length, 1);
        assert.equal(reports[0].reportId, reportId);
      } finally {
        console.warn = originalWarn;
      }

      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /\[reportStore\] Skipping invalid report "broken-report" during report listing:/);
    });
  });

  await run('fails closed on direct file routes when hidden reports state is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-hidden-state-1')), 'hidden-state.zip');
      const reportsDir = path.join(dataDir, 'reports');
      await fs.writeFile(path.join(reportsDir, '.hidden-report-ids.json'), '{"broken": true}', 'utf8');

      await assert.rejects(
        reportStore.listReports(),
        (error) => {
          assert.equal(error.statusCode, 500);
          assert.equal(error.userMessage, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0441\u043b\u0443\u0436\u0435\u0431\u043d\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0441\u043a\u0440\u044b\u0442\u044b\u0445 \u043e\u0442\u0447\u0435\u0442\u043e\u0432.');
          assert.equal(error.internalCode, 'INVALID_HIDDEN_REPORTS_STATE');
          return true;
        }
      );

      const server = await startServer(createApp());
      try {
        for (const route of [`/reports/${reportId}/photos/card.jpg`, `/reports/${reportId}/raw`, `/reports/${reportId}/zip`]) {
          const response = await request(server, route);
          const body = response.body.toString('utf8');
          assert.equal(response.statusCode, 500);
          assert.doesNotMatch(body, /sidebar-clear-form/);
          assert.match(body, /<div class="empty-state">/);
          assert.match(body, /<a href="\/" class="button">/);
        }
      } finally {
        server.close();
      }
    });
  });

  await run('fails closed on direct report page when hidden reports state is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-hidden-state-direct-1')), 'hidden-state-direct.zip');
      const reportsDir = path.join(dataDir, 'reports');
      await fs.writeFile(path.join(reportsDir, '.hidden-report-ids.json'), '{"broken": true}', 'utf8');

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 500);
        assert.doesNotMatch(body, /sidebar-clear-form/);
        assert.match(body, /<div class="empty-state">/);
        assert.match(body, /<a href="\/" class="button">/);
      } finally {
        server.close();
      }
    });
  });

  await run('requires explicit server-side confirmation before clearing reports', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-clear-confirm-1')), 'clear-confirm.zip');

      const server = await startServer(createApp());
      try {
        const response = await requestWithBody(
          server,
          'POST',
          '/admin/reports/clear',
          Buffer.from('confirm=clear-all', 'utf8'),
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );

        assert.equal(response.statusCode, 303);
        assert.equal(response.headers.location, '/?cleared=1');
        assert.equal((await reportStore.listReports()).length, 0);
      } finally {
        server.close();
      }
    });
  });

  await run('rejects clear-reports requests without a valid confirmation token', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore, createApp } = loadModules(dataDir);
      await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-clear-confirm-2')), 'clear-confirm-missing.zip');

      const server = await startServer(createApp());
      try {
        for (const bodyValue of ['', 'confirm=nope']) {
          const response = await requestWithBody(
            server,
            'POST',
            '/admin/reports/clear',
            Buffer.from(bodyValue, 'utf8'),
            { 'Content-Type': 'application/x-www-form-urlencoded' }
          );
          const body = response.body.toString('utf8');
          assert.equal(response.statusCode, 400);
          assert.match(body, /\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043e\u0447\u0438\u0441\u0442\u043a\u0443 \u043e\u0442\u0447\u0435\u0442\u043e\u0432\./);
        }

        assert.equal((await reportStore.listReports()).length, 1);
      } finally {
        server.close();
      }
    });
  });

  await run('does not leak internal file paths on unexpected 500 responses', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(
        buildZipFromReport(buildValidReport('report-500-path-1')),
        'report-500-path.zip'
      );
      const { createApp } = loadModulesWithPatchedModules(dataDir, {
        patchReportDashboardModel(patchedReportDashboardModel) {
          patchedReportDashboardModel.buildReportDashboardModel = () => {
            throw new Error('C:\\secret\\reports\\report.json');
          };
        }
      });

      const server = await startServer(createApp());
      try {
        const response = await request(server, `/reports/${reportId}`);
        const body = response.body.toString('utf8');
        assert.equal(response.statusCode, 500);
        assert.match(body, /\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430\./);
        assert.doesNotMatch(body, /C:\\secret\\reports\\report\.json/);
        assert.doesNotMatch(body, /secret\\\\reports/);
        assertNoCommonMojibake(body);
      } finally {
        server.close();
      }
    });
  });

  await run('keeps report visible when derived summary.json is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-summary-list-1')), 'summary-list.zip');
      const summaryPath = path.join(dataDir, 'reports', reportId, 'summary.json');
      await fs.writeFile(summaryPath, '{"cardsCount":', 'utf8');

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message) => warnings.push(String(message));
      try {
        const reports = await reportStore.listReports();
        assert.equal(reports.length, 1);
        assert.equal(reports[0].reportId, reportId);
        assert.equal(reports[0].summary.cardsCount, 1);
      } finally {
        console.warn = originalWarn;
      }

      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /\[reportStore\] Ignoring invalid summary for "report-summary-list-1":/);
    });
  });

  await run('keeps report readable when derived summary.json is corrupted', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const reportId = await reportStore.processUploadedReport(buildZipFromReport(buildValidReport('report-summary-view-1')), 'summary-view.zip');
      const summaryPath = path.join(dataDir, 'reports', reportId, 'summary.json');
      await fs.writeFile(summaryPath, '{"eventsCount":', 'utf8');

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message) => warnings.push(String(message));
      try {
        const report = await reportStore.getReport(reportId);
        assert.ok(report);
        assert.equal(report.reportId, reportId);
        assert.equal(report.summary.cardsCount, 1);
        assert.equal(report.summary.eventsCount, 1);
      } finally {
        console.warn = originalWarn;
      }

      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /\[reportStore\] Ignoring invalid summary for "report-summary-view-1":/);
    });
  });

  await run('preserves existing report data when staged import fails', async () => {
    await withTempDir(async (dataDir) => {
      const { reportStore } = loadModules(dataDir);
      const reportId = 'report-atomic-1';
      const reportDir = path.join(dataDir, 'reports', reportId);
      await fs.mkdir(path.join(reportDir, 'photos'), { recursive: true });
      await fs.mkdir(path.join(reportDir, 'original.zip'), { recursive: true });
      await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(buildValidReport(reportId), null, 2)}\n`, 'utf8');
      await fs.writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify({ cardsCount: 1 }, null, 2)}\n`, 'utf8');
      await fs.writeFile(path.join(reportDir, 'photos', 'keep.txt'), 'keep', 'utf8');

      const zip = buildZipFromReport(buildValidReport(reportId));
      await assert.rejects(
        reportStore.processUploadedReport(zip, 'atomic.zip')
      );

      const storedReport = JSON.parse(await fs.readFile(path.join(reportDir, 'report.json'), 'utf8'));
      assert.equal(storedReport.reportId, reportId);
      const keptPhoto = await fs.readFile(path.join(reportDir, 'photos', 'keep.txt'), 'utf8');
      assert.equal(keptPhoto, 'keep');
      const originalZipStat = await fs.lstat(path.join(reportDir, 'original.zip'));
      assert.equal(originalZipStat.isDirectory(), true);
    });
  });
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});


