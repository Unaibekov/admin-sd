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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-problems-route-'));
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
    cardId: 'card-1',
    code: 'BATCH-1',
    cultureName: 'Береза',
    speciesName: 'Повислая',
    stage: 'Теплица',
    batchStatus: 'problem',
    currentQuantity: 120,
    activeProblemQuantity: 20,
    healthStatus: 'infected',
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
    events: [{
      eventId: 'problem-event-1',
      type: 'problem',
      createdAt: '2026-08-06T09:00:00.000Z',
      problemType: 'Контаминация',
      riskLevel: 'High',
      createdBy: 'Anna Ivanova'
    }],
    ...overrides
  };
}

async function importReport(reportStore, dataDir, report) {
  const zipPath = path.join(dataDir, `${report.reportId}.zip`);
  await fs.writeFile(zipPath, createZip([
    { name: 'report.json', data: JSON.stringify(report) },
    { name: 'photos/card.jpg', data: Buffer.from('image') }
  ]));
  await reportStore.processUploadedReport(zipPath, `${report.reportId}.zip`);
}

run('GET /problems renders active and isolated cases without duplicates', async () => {
  await withTempDir(async (dataDir) => {
    const { reportStore, createApp } = loadModules(dataDir);

    await importReport(reportStore, dataDir, buildReport('problems-a', [
      buildCard({
        cardId: 'parent-1',
        code: 'PARENT-1',
        activeProblemQuantity: 0,
        batchStatus: 'active',
        healthStatus: 'healthy',
        events: [{
          eventId: 'parent-problem',
          type: 'problem',
          createdAt: '2026-08-05T09:00:00.000Z',
          problemType: 'Контаминация',
          riskLevel: 'High',
          createdBy: 'Anna Ivanova'
        }]
      }),
      buildCard({
        cardId: 'child-1',
        code: 'ISO-1',
        originType: 'problemIsolation',
        parentCardId: 'parent-1',
        parentCode: 'PARENT-1',
        batchStatus: 'quarantine',
        currentQuantity: 40,
        activeProblemQuantity: 40,
        healthStatus: 'infected',
        isolationStatus: 'isolated',
        events: [{
          eventId: 'child-created',
          type: 'isolatedFromParent',
          createdAt: '2026-08-06T09:05:00.000Z',
          count: 40,
          parentCardId: 'parent-1',
          parentCode: 'PARENT-1',
          healthStatus: 'infected',
          isolationStatus: 'isolated',
          activeProblemQuantity: 40
        }]
      })
    ]));

    await importReport(reportStore, dataDir, buildReport('problems-b', [
      buildCard({
        cardId: 'resolved-1',
        code: 'RES-1',
        batchStatus: 'active',
        activeProblemQuantity: 0,
        healthStatus: 'resolved',
        events: [
          {
            eventId: 'resolved-problem',
            type: 'problem',
            createdAt: '2026-08-05T09:00:00.000Z',
            problemType: 'Карантин',
            riskLevel: 'Medium',
            createdBy: 'Petr Petrov'
          },
          {
            eventId: 'resolved-recovery',
            type: 'problemRecovery',
            createdAt: '2026-08-06T09:00:00.000Z',
            activeProblemQuantity: 0,
            healthStatus: 'healthy',
            isolationStatus: 'released'
          }
        ]
      })
    ], {
      userId: 'user-2',
      displayName: 'Petr Petrov',
      deviceId: 'device-2'
    }));

    const server = await startServer(createApp());
    try {
      const response = await request(server, '/problems');
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /Проблемы/);
      assert.match(response.body, /ISO-1/);
      assert.match(response.body, /Открыть паспорт/);
      assert.doesNotMatch(response.body, /<strong>PARENT-1<\/strong>/);

      const isolatedResponse = await request(server, '/problems?status=isolated');
      assert.equal(isolatedResponse.statusCode, 200);
      assert.match(isolatedResponse.body, /ISO-1/);
      assert.doesNotMatch(isolatedResponse.body, /RES-1/);

      const resolvedResponse = await request(server, '/problems?status=resolved');
      assert.equal(resolvedResponse.statusCode, 200);
      assert.match(resolvedResponse.body, /RES-1/);

      const filteredResponse = await request(server, '/problems?employee=user-2&type=%D0%9A%D0%B0%D1%80%D0%B0%D0%BD%D1%82%D0%B8%D0%BD&risk=medium&status=resolved');
      assert.equal(filteredResponse.statusCode, 200);
      assert.match(filteredResponse.body, /Petr Petrov/);
      assert.match(filteredResponse.body, /RES-1/);
      assert.doesNotMatch(filteredResponse.body, /ISO-1/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

if (process.exitCode) process.exit(process.exitCode);
