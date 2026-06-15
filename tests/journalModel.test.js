const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { buildJournalModel } = require('../src/journalModel');

function loadSampleReport() {
  const reportsDir = path.join(process.cwd(), 'data', 'reports');
  const reportFolders = fs.readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(reportsDir, entry.name))
    .sort();

  for (const folder of reportFolders) {
    const reportPath = path.join(folder, 'report.json');
    if (fs.existsSync(reportPath)) {
      return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }
  }

  throw new Error('Sample report.json not found');
}

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

run('buildJournalModel filters report-wide entries by stage and resets invalid subtab', () => {
  const report = loadSampleReport();
  const stage = report.cards.find((card) => card.stage && card.stage !== 'all').stage;
  const model = buildJournalModel(report, {
    stage,
    subtab: 'observation'
  });

  assert.equal(model.selectedStage, stage);
  assert.equal(model.selectedSubtab, 'all');
  assert.ok(model.stageTabs.some((tab) => tab.key === stage && tab.active));
  assert.ok(model.subtabTabs.every((tab) => tab.key !== 'observation'));
  assert.ok(model.entries.every((entry) => entry.stage === stage));
});

run('buildJournalModel filters by subtype across all cards in the report', () => {
  const report = loadSampleReport();
  const stage = report.cards[5] && report.cards[5].stage ? report.cards[5].stage : report.cards[0].stage;
  const stageModel = buildJournalModel(report, {
    stage,
    subtab: 'all'
  });
  const targetSubtab = stageModel.subtabTabs.find((tab) => tab.key !== 'all' && tab.count > 0);
  assert.ok(targetSubtab);

  const model = buildJournalModel(report, {
    stage,
    subtab: targetSubtab.key
  });

  assert.equal(model.selectedStage, stage);
  assert.equal(model.selectedSubtab, targetSubtab.key);
  assert.ok(model.entries.length > 0);
  assert.ok(model.entries.every((entry) => entry.stage === stage));
  assert.ok(model.entries.every((entry) => entry.subtype === targetSubtab.key));
  assert.ok(model.selectedEntry);
});

run('buildJournalModel ignores empty leading cards and still shows report events', () => {
  const report = loadSampleReport();
  const clonedReport = JSON.parse(JSON.stringify(report));
  if (clonedReport.cards[0]) {
    clonedReport.cards[0].events = [];
  }

  const model = buildJournalModel(clonedReport, {});

  assert.ok(model.totalEntries > 0);
  assert.ok(model.entries.length > 0);
  assert.ok(model.selectedEntry);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
