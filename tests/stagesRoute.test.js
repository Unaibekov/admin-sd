const assert = require('assert/strict');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

function run(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

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
    const nameBuffer = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const crc = crc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    const localPart = Buffer.concat([localHeader, nameBuffer, dataBuffer]);
    localParts.push(localPart);
    centralParts.push(Buffer.concat([centralHeader, nameBuffer]));
    offset += localPart.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localDirectory.length, 16);

  return Buffer.concat([localDirectory, centralDirectory, endRecord]);
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

async function withTempDir(fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-stages-route-'));
  try {
    return await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
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
    const req = http.get({ host: '127.0.0.1', port, path: targetPath }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
  });
}

function buildReport(reportId, cards, overrides = {}) {
  return {
    reportId,
    createdAt: overrides.createdAt || '2026-08-07T09:00:00.000Z',
    deviceId: overrides.deviceId || 'device-1',
    user: {
      userId: overrides.userId || 'user-1',
      displayName: overrides.displayName || 'Anna Ivanova',
      role: 'agronomist'
    },
    cards
  };
}

function buildCard(overrides = {}) {
  return {
    cardId: overrides.cardId || 'card-1',
    code: overrides.code || 'BATCH-1',
    cultureName: 'Береза',
    speciesName: 'Повислая',
    stage: overrides.stage || 'Теплица',
    batchStatus: overrides.batchStatus || 'active',
    currentQuantity: overrides.currentQuantity || 120,
    activeProblemQuantity: overrides.activeProblemQuantity ?? 0,
    healthStatus: overrides.healthStatus || 'healthy',
    isolationStatus: overrides.isolationStatus || '',
    originType: overrides.originType || '',
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
    events: overrides.events || []
  };
}

async function importReport(reportStore, dataDir, report) {
  const zipPath = path.join(dataDir, `${report.reportId}.zip`);
  await fs.writeFile(zipPath, createZip([
    { name: 'report.json', data: JSON.stringify(report) }
  ]));
  await reportStore.processUploadedReport(zipPath, `${report.reportId}.zip`);
}

run('GET /stages keeps server-side filters in URL and filters cards by employee, stage and status', async () => {
  await withTempDir(async (dataDir) => {
    const { reportStore, createApp } = loadModules(dataDir);

    await importReport(reportStore, dataDir, buildReport('stages-a', [
      buildCard({
        cardId: 'active-1',
        code: 'ACTIVE-1',
        stage: 'Теплица',
        batchStatus: 'active',
        activeProblemQuantity: 0,
        healthStatus: 'healthy'
      }),
      buildCard({
        cardId: 'problem-1',
        code: 'PROBLEM-1',
        stage: 'Теплица',
        batchStatus: 'problem',
        activeProblemQuantity: 7,
        healthStatus: 'infected'
      }),
      buildCard({
        cardId: 'isolated-1',
        code: 'ISO-1',
        stage: 'Теплица',
        batchStatus: 'quarantine',
        originType: 'problemIsolation',
        isolationStatus: 'isolated',
        activeProblemQuantity: 3,
        healthStatus: 'infected'
      }),
      buildCard({
        cardId: 'released-1',
        code: 'REL-1',
        stage: 'Теплица',
        batchStatus: 'quarantine',
        originType: 'problemIsolation',
        isolationStatus: 'released',
        activeProblemQuantity: 0,
        healthStatus: 'healthy'
      }),
      buildCard({
        cardId: 'completed-1',
        code: 'DONE-1',
        stage: 'Адаптация',
        batchStatus: 'completed',
        healthStatus: 'healthy'
      })
    ], {
      userId: 'anna',
      displayName: 'Anna Ivanova',
      deviceId: 'device-a'
    }));

    await importReport(reportStore, dataDir, buildReport('stages-b', [
      buildCard({
        cardId: 'archived-1',
        code: 'ARCH-1',
        stage: 'Высадка',
        batchStatus: 'archived',
        healthStatus: 'healthy'
      })
    ], {
      userId: 'petr',
      displayName: 'Petr Petrov',
      deviceId: 'device-b'
    }));

    const server = await startServer(createApp());
    try {
      const rootResponse = await request(server, '/stages');
      assert.equal(rootResponse.statusCode, 200);
      assert.match(rootResponse.body, /Партии/);
      assert.match(rootResponse.body, /ACTIVE-1/);
      assert.match(rootResponse.body, /PROBLEM-1/);
      assert.match(rootResponse.body, /ISO-1/);
      assert.match(rootResponse.body, /Статус/);

      const employeeResponse = await request(server, '/stages?employee=anna');
      assert.equal(employeeResponse.statusCode, 200);
      assert.match(employeeResponse.body, /ACTIVE-1/);
      assert.doesNotMatch(employeeResponse.body, /ARCH-1/);
      assert.match(employeeResponse.body, /Сотрудники[\s\S]*1/);

      const stageResponse = await request(server, '/stages?stage=%D0%90%D0%B4%D0%B0%D0%BF%D1%82%D0%B0%D1%86%D0%B8%D1%8F');
      assert.equal(stageResponse.statusCode, 200);
      assert.match(stageResponse.body, /DONE-1/);
      assert.doesNotMatch(stageResponse.body, /ACTIVE-1/);

      const problemResponse = await request(server, '/stages?status=problem');
      assert.equal(problemResponse.statusCode, 200);
      assert.match(problemResponse.body, /PROBLEM-1/);
      assert.doesNotMatch(problemResponse.body, /ISO-1/);
      assert.doesNotMatch(problemResponse.body, /REL-1/);

      const isolatedResponse = await request(server, '/stages?status=isolated');
      assert.equal(isolatedResponse.statusCode, 200);
      assert.match(isolatedResponse.body, /ISO-1/);
      assert.doesNotMatch(isolatedResponse.body, /REL-1/);

      const combinedResponse = await request(server, '/stages?employee=anna&stage=%D0%A2%D0%B5%D0%BF%D0%BB%D0%B8%D1%86%D0%B0&status=problem');
      assert.equal(combinedResponse.statusCode, 200);
      assert.match(combinedResponse.body, /PROBLEM-1/);
      assert.doesNotMatch(combinedResponse.body, /ISO-1/);
      assert.doesNotMatch(combinedResponse.body, /ACTIVE-1/);

      const invalidStatusResponse = await request(server, '/stages?status=missing-status');
      assert.equal(invalidStatusResponse.statusCode, 200);
      assert.match(invalidStatusResponse.body, /ACTIVE-1/);
      assert.match(invalidStatusResponse.body, /ARCH-1/);

      const selectedBatchResponse = await request(server, '/stages?status=completed&batchId=device-a%3A%3Aactive-1');
      assert.equal(selectedBatchResponse.statusCode, 200);
      assert.match(selectedBatchResponse.body, /Партии не найдены|Выберите партию слева|DONE-1/);
      assert.doesNotMatch(selectedBatchResponse.body, /data-selected-batch/);
      assert.doesNotMatch(selectedBatchResponse.body, /ACTIVE-1[\s\S]*data-selected-batch/);
    } finally {
      server.close();
    }
  });
});
