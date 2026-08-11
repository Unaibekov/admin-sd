const assert = require('assert/strict');
const { buildProblemsPageModel } = require('../src/problemsPageModel');

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function buildReport({
  reportId,
  createdAt = '2026-08-07T09:00:00.000Z',
  userId = 'user-1',
  displayName = 'Anna Ivanova',
  role = 'agronomist',
  cards = []
}) {
  return {
    reportId,
    createdAt,
    deviceId: 'device-1',
    user: { userId, displayName, role },
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
    batchStatus: 'active',
    currentQuantity: 300,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
    events: [],
    ...overrides
  };
}

function buildProblemEvent(overrides = {}) {
  return {
    eventId: 'problem-event-1',
    type: 'problem',
    createdAt: '2026-08-05T09:00:00.000Z',
    problemType: 'Контаминация',
    riskLevel: 'High',
    createdBy: 'Anna Ivanova',
    ...overrides
  };
}

run('counts a normal active problem batch once', () => {
  const report = buildReport({
    reportId: 'active-report',
    cards: [buildCard({
      activeProblemQuantity: 40,
      healthStatus: 'infected',
      events: [buildProblemEvent()]
    })]
  });

  const page = buildProblemsPageModel([report], {});

  assert.equal(page.counts.active, 1);
  assert.equal(page.counts.resolved, 0);
  assert.equal(page.problemCases[0].activeProblemQuantity, 40);
});

run('treats recovered history as resolved and not active', () => {
  const report = buildReport({
    reportId: 'recovered-report',
    cards: [buildCard({
      activeProblemQuantity: 0,
      healthStatus: 'resolved',
      batchStatus: 'active',
      events: [
        buildProblemEvent(),
        {
          eventId: 'recovery-1',
          type: 'problemRecovery',
          createdAt: '2026-08-06T10:00:00.000Z',
          healthStatus: 'healthy',
          isolationStatus: 'released',
          activeProblemQuantity: 0
        }
      ]
    })]
  });

  const page = buildProblemsPageModel([report], { status: 'resolved' });

  assert.equal(page.counts.active, 0);
  assert.equal(page.counts.resolved, 1);
  assert.equal(page.problemCases[0].statusKey, 'resolved');
});

run('treats latest recovery as resolved even when batch active quantity is stale', () => {
  const report = buildReport({
    reportId: 'recovered-stale-batch',
    cards: [buildCard({
      activeProblemQuantity: 5,
      healthStatus: 'infected',
      batchStatus: 'problem',
      events: [
        buildProblemEvent({
          eventId: 'problem-1',
          createdAt: '2026-08-05T09:00:00.000Z',
          riskLevel: 'High'
        }),
        {
          eventId: 'recovery-2',
          type: 'problemRecovery',
          createdAt: '2026-08-06T10:00:00.000Z',
          healthStatus: 'healthy',
          isolationStatus: 'released',
          activeProblemQuantity: 0,
          recoveredQuantity: 2
        }
      ]
    })]
  });

  const page = buildProblemsPageModel([report], { status: 'resolved' });

  assert.equal(page.counts.active, 0);
  assert.equal(page.counts.resolved, 1);
  assert.equal(page.problemCases[0].statusKey, 'resolved');
});

run('does not keep healthy parent in active after full isolation', () => {
  const report = buildReport({
    reportId: 'full-isolation-report',
    cards: [
      buildCard({
        cardId: 'parent-1',
        code: 'PARENT-1',
        activeProblemQuantity: 0,
        healthStatus: 'healthy',
        batchStatus: 'active',
        events: [
          buildProblemEvent({
            eventId: 'parent-problem',
            activeProblemQuantity: 500
          }),
          {
            eventId: 'parent-isolation',
            type: 'problemIsolation',
            createdAt: '2026-08-06T09:00:00.000Z',
            count: 500,
            childCardId: 'child-1',
            childCode: 'ISO-1',
            healthStatus: 'healthy',
            isolationStatus: 'isolated',
            activeProblemQuantity: 0,
            unisolatedProblemQuantity: 0
          }
        ]
      }),
      buildCard({
        cardId: 'child-1',
        code: 'ISO-1',
        currentQuantity: 500,
        batchStatus: 'quarantine',
        originType: 'problemIsolation',
        parentCardId: 'parent-1',
        parentCode: 'PARENT-1',
        activeProblemQuantity: 500,
        healthStatus: 'infected',
        isolationStatus: 'isolated',
        events: [
          {
            eventId: 'child-created',
            type: 'isolatedFromParent',
            createdAt: '2026-08-06T09:05:00.000Z',
            count: 500,
            parentCardId: 'parent-1',
            parentCode: 'PARENT-1',
            healthStatus: 'infected',
            isolationStatus: 'isolated',
            activeProblemQuantity: 500
          }
        ]
      })
    ]
  });

  const page = buildProblemsPageModel([report], { status: 'active' });

  assert.equal(page.counts.active, 1);
  assert.equal(page.counts.isolated, 1);
  assert.equal(page.problemCases.length, 1);
  assert.equal(page.problemCases[0].code, 'ISO-1');
});

run('shows parent and child separately for partial isolation', () => {
  const report = buildReport({
    reportId: 'partial-isolation-report',
    cards: [
      buildCard({
        cardId: 'parent-2',
        code: 'PARENT-2',
        currentQuantity: 700,
        activeProblemQuantity: 200,
        unisolatedProblemQuantity: 200,
        healthStatus: 'infected',
        batchStatus: 'problem',
        events: [buildProblemEvent({ eventId: 'partial-parent-problem' })]
      }),
      buildCard({
        cardId: 'child-2',
        code: 'ISO-2',
        currentQuantity: 300,
        batchStatus: 'quarantine',
        originType: 'problemIsolation',
        parentCardId: 'parent-2',
        parentCode: 'PARENT-2',
        activeProblemQuantity: 300,
        healthStatus: 'infected',
        isolationStatus: 'isolated',
        events: [{
          eventId: 'partial-child-created',
          type: 'isolatedFromParent',
          createdAt: '2026-08-06T09:05:00.000Z',
          count: 300,
          parentCardId: 'parent-2',
          parentCode: 'PARENT-2',
          healthStatus: 'infected',
          isolationStatus: 'isolated',
          activeProblemQuantity: 300
        }]
      })
    ]
  });

  const page = buildProblemsPageModel([report], { status: 'active' });

  assert.equal(page.counts.active, 2);
  assert.equal(page.problemCases.length, 2);
});

run('drops released isolation from active and isolated but keeps it resolved', () => {
  const report = buildReport({
    reportId: 'released-isolation-report',
    cards: [buildCard({
      cardId: 'child-3',
      code: 'ISO-3',
      batchStatus: 'quarantine',
      originType: 'problemIsolation',
      activeProblemQuantity: 0,
      healthStatus: 'healthy',
      isolationStatus: 'released',
      events: [
        {
          eventId: 'iso-start',
          type: 'isolatedFromParent',
          createdAt: '2026-08-05T09:05:00.000Z',
          count: 500,
          healthStatus: 'infected',
          isolationStatus: 'isolated',
          activeProblemQuantity: 500
        },
        {
          eventId: 'iso-recovery',
          type: 'problemRecovery',
          createdAt: '2026-08-06T09:05:00.000Z',
          quantity: 500,
          healthStatus: 'healthy',
          isolationStatus: 'released',
          activeProblemQuantity: 0
        }
      ]
    })]
  });

  const page = buildProblemsPageModel([report], {});

  assert.equal(page.counts.active, 0);
  assert.equal(page.counts.isolated, 0);
  assert.equal(page.counts.resolved, 1);
});

run('deduplicates the same card across multiple snapshots', () => {
  const olderReport = buildReport({
    reportId: 'snapshot-old',
    createdAt: '2026-08-05T09:00:00.000Z',
    cards: [buildCard({
      cardId: 'same-card',
      code: 'SAME-1',
      activeProblemQuantity: 10,
      updatedAt: '2026-08-05T09:00:00.000Z',
      events: [buildProblemEvent({ eventId: 'same-problem-old' })]
    })]
  });
  const newerReport = buildReport({
    reportId: 'snapshot-new',
    createdAt: '2026-08-06T09:00:00.000Z',
    cards: [buildCard({
      cardId: 'same-card',
      code: 'SAME-1',
      activeProblemQuantity: 10,
      updatedAt: '2026-08-06T09:00:00.000Z',
      events: [buildProblemEvent({ eventId: 'same-problem-new', createdAt: '2026-08-06T09:00:00.000Z' })]
    })]
  });

  const page = buildProblemsPageModel([olderReport, newerReport], {});

  assert.equal(page.counts.active, 1);
  assert.equal(page.problemCases.length, 1);
  assert.equal(page.problemCases[0].reportId, 'snapshot-new');
});

run('keeps different batches of the same plant separate', () => {
  const report = buildReport({
    reportId: 'same-plant-report',
    cards: [
      buildCard({
        cardId: 'card-a',
        code: 'A-1',
        cultureName: 'Береза',
        activeProblemQuantity: 5,
        events: [buildProblemEvent({ eventId: 'plant-a' })]
      }),
      buildCard({
        cardId: 'card-b',
        code: 'B-1',
        cultureName: 'Береза',
        activeProblemQuantity: 7,
        events: [buildProblemEvent({ eventId: 'plant-b', riskLevel: 'Medium' })]
      })
    ]
  });

  const page = buildProblemsPageModel([report], {});

  assert.equal(page.counts.active, 2);
  assert.equal(page.problemCases.length, 2);
});

run('sorts visible cases by risk priority', () => {
  const report = buildReport({
    reportId: 'risk-order-report',
    cards: [
      buildCard({
        cardId: 'risk-low',
        code: 'LOW-1',
        activeProblemQuantity: 2,
        riskLevel: 'Low',
        events: [buildProblemEvent({ eventId: 'risk-low-event', riskLevel: 'Low' })]
      }),
      buildCard({
        cardId: 'risk-critical',
        code: 'CRIT-1',
        activeProblemQuantity: 2,
        riskLevel: 'Critical',
        events: [buildProblemEvent({ eventId: 'risk-critical-event', riskLevel: 'Critical' })]
      }),
      buildCard({
        cardId: 'risk-high',
        code: 'HIGH-1',
        activeProblemQuantity: 2,
        riskLevel: 'High',
        events: [buildProblemEvent({ eventId: 'risk-high-event', riskLevel: 'High' })]
      })
    ]
  });

  const page = buildProblemsPageModel([report], {});

  assert.deepEqual(page.problemCases.map((item) => item.code), ['CRIT-1', 'HIGH-1', 'LOW-1']);
});

run('filters by employee', () => {
  const firstReport = buildReport({
    reportId: 'employee-a',
    displayName: 'Anna Ivanova',
    userId: 'anna',
    cards: [buildCard({
      cardId: 'anna-card',
      code: 'AN-1',
      activeProblemQuantity: 3,
      events: [buildProblemEvent({ eventId: 'anna-problem' })]
    })]
  });
  const secondReport = buildReport({
    reportId: 'employee-b',
    displayName: 'Petr Petrov',
    userId: 'petr',
    cards: [buildCard({
      cardId: 'petr-card',
      code: 'PT-1',
      activeProblemQuantity: 3,
      events: [buildProblemEvent({ eventId: 'petr-problem' })]
    })]
  });

  const page = buildProblemsPageModel([firstReport, secondReport], { employee: 'anna' });

  assert.equal(page.problemCases.length, 1);
  assert.equal(page.problemCases[0].employeeKey, 'anna');
});

run('filters by problem type', () => {
  const report = buildReport({
    reportId: 'type-filter-report',
    cards: [
      buildCard({
        cardId: 'type-a',
        code: 'TA-1',
        problemType: 'Контаминация',
        activeProblemQuantity: 2,
        events: [buildProblemEvent({ eventId: 'type-a-event', problemType: 'Контаминация' })]
      }),
      buildCard({
        cardId: 'type-b',
        code: 'TB-1',
        problemType: 'Карантин',
        activeProblemQuantity: 2,
        batchStatus: 'quarantine',
        events: [buildProblemEvent({ eventId: 'type-b-event', problemType: 'Карантин' })]
      })
    ]
  });

  const page = buildProblemsPageModel([report], { type: 'Карантин' });

  assert.equal(page.problemCases.length, 1);
  assert.equal(page.problemCases[0].problemType, 'Карантин');
});

if (process.exitCode) process.exit(process.exitCode);
