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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sadovnik-dashboard-route-'));
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

async function importReport(reportStore, dataDir, report, extraEntries = []) {
  const zipPath = path.join(dataDir, `${report.reportId}.zip`);
  await fs.writeFile(zipPath, createZip([
    { name: 'report.json', data: JSON.stringify(report) },
    ...extraEntries
  ]));
  await reportStore.processUploadedReport(zipPath, `${report.reportId}.zip`);
}

run('GET / renders grouped photo cards with modal payload for dashboard photos', async () => {
  await withTempDir(async (dataDir) => {
    const { reportStore, createApp } = loadModules(dataDir);

    await importReport(reportStore, dataDir, {
      reportId: 'dashboard-photos',
      createdAt: '2026-08-07T09:00:00.000Z',
      deviceId: 'device-1',
      user: { userId: 'anna', displayName: 'Anna Ivanova', role: 'agronomist' },
      cards: [{
        cardId: 'card-1',
        code: 'BATCH-1',
        cultureName: 'Берёза',
        speciesName: 'Повислая',
        stage: 'Теплица',
        batchStatus: 'problem',
        currentQuantity: 120,
        createdAt: '2026-08-05T09:00:00.000Z',
        updatedAt: '2026-08-07T09:00:00.000Z',
        events: [
          {
            eventId: 'problem-photo-group',
            type: 'problem',
            createdAt: '2026-08-07T09:00:00.000Z',
            problemType: 'Контаминация',
            riskLevel: 'Высокий',
            photoFiles: ['photos/problem-1.jpg', 'photos/problem-2.jpg']
          },
          {
            eventId: 'care-photo',
            type: 'greenhouseCare',
            createdAt: '2026-08-06T09:00:00.000Z',
            photoFiles: ['photos/care-1.jpg']
          }
        ]
      }]
    }, [
      { name: 'photos/problem-1.jpg', data: Buffer.from([1, 2, 3]) },
      { name: 'photos/problem-2.jpg', data: Buffer.from([4, 5, 6]) },
      { name: 'photos/care-1.jpg', data: Buffer.from([7, 8, 9]) }
    ]);

    const server = await startServer(createApp());
    try {
      const response = await request(server, '/?reportId=dashboard-photos&period=all');
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /Последние фотофиксации/);

      const cardMatches = response.body.match(/data-photo-card=/g) || [];
      assert.equal(cardMatches.length, 2);
      assert.match(response.body, /problem-photo-group/);
      assert.match(response.body, /reportId=dashboard-photos/);
      assert.match(response.body, /eventId=problem-photo-group/);
      assert.match(response.body, /photo-modal-title/);
      assert.match(response.body, /Детали события/);
      assert.doesNotMatch(response.body, /<span class="dashboard-thumb-code">BATCH-1<\/span>/);
    } finally {
      server.close();
    }
  });
});

run('GET /photos renders paginated global photo gallery', async () => {
  await withTempDir(async (dataDir) => {
    const { reportStore, createApp } = loadModules(dataDir);

    const cards = Array.from({ length: 13 }, (_, index) => ({
      cardId: `card-${index + 1}`,
      code: `BATCH-${index + 1}`,
      cultureName: `Plant ${index + 1}`,
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 10,
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
      events: [{
        eventId: `photo-${index + 1}`,
        type: 'greenhouseCare',
        createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        photoFiles: [`photos/photo-${index + 1}.jpg`]
      }]
    }));

    await importReport(reportStore, dataDir, {
      reportId: 'photos-many',
      createdAt: '2026-08-11T09:00:00.000Z',
      deviceId: 'device-photos',
      user: { userId: 'anna', displayName: 'Anna Ivanova', role: 'agronomist' },
      cards
    }, cards.map((_, index) => ({
      name: `photos/photo-${index + 1}.jpg`,
      data: Buffer.from([index + 1])
    })));

    const server = await startServer(createApp());
    try {
      const page1 = await request(server, '/photos');
      assert.equal(page1.statusCode, 200);
      assert.match(page1.body, /Фотофиксации/);
      assert.match(page1.body, /Страница 1 из 2/);
      assert.match(page1.body, /1–12 из 13/);

      const page2 = await request(server, '/photos?page=2');
      assert.equal(page2.statusCode, 200);
      assert.match(page2.body, /Страница 2 из 2/);
      assert.match(page2.body, /13–13 из 13/);
    } finally {
      server.close();
    }
  });
});

run('GET /photos keeps report scope in pagination', async () => {
  await withTempDir(async (dataDir) => {
    const { reportStore, createApp } = loadModules(dataDir);

    const cards = Array.from({ length: 13 }, (_, index) => ({
      cardId: `scope-card-${index + 1}`,
      code: `SCOPE-${index + 1}`,
      cultureName: `Scoped ${index + 1}`,
      stage: 'Теплица',
      batchStatus: 'active',
      currentQuantity: 10,
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
      events: [{
        eventId: `scope-photo-${index + 1}`,
        type: 'greenhouseCare',
        createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        photoFiles: [`photos/scope-photo-${index + 1}.jpg`]
      }]
    }));

    await importReport(reportStore, dataDir, {
      reportId: 'photos-scope',
      createdAt: '2026-08-11T09:00:00.000Z',
      deviceId: 'device-scope',
      user: { userId: 'pavel', displayName: 'Pavel Sokolov', role: 'greenhouse' },
      cards
    }, cards.map((_, index) => ({
      name: `photos/scope-photo-${index + 1}.jpg`,
      data: Buffer.from([index + 1, index + 2])
    })));

    const server = await startServer(createApp());
    try {
      const response = await request(server, '/photos?reportId=photos-scope');
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /Фотофиксации отчета/);
      assert.match(response.body, /Pavel Sokolov/);
      assert.match(response.body, /reportId=photos-scope(?:&amp;|&)page=2/);
    } finally {
      server.close();
    }
  });
});
