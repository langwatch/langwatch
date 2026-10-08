// specs/upgrade/upgrade-rehearsal.feature: phase 2's findings over collected evidence.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate, NOWG_STEP_IDS, renderReport, summariseQueues, VERDICT } from "../evaluate.mjs";

const HEAD = "langwatch-rehearsal:head";
const finding = (evidence, id) => evaluate(evidence).find((f) => f.id === id);

void describe("R01, privacy resolution", () => {
  /** @scenario "Old projects with no resolved privacy policy after the upgrade reproduce R01" */
  void it("is reproduced and names the projects unresolved", () => {
    const r01 = finding(
      {
        resolution: [
          { projectId: "rh_1_p_team", privacy: false, retention: false, folded: false },
          { projectId: "rh_1_p_org_b", privacy: true, retention: true, folded: true },
        ],
      },
      "R01",
    );
    assert.equal(r01.verdict, VERDICT.reproduced);
    assert.match(r01.detail, /1 of 2/);
    assert.match(r01.detail, /rh_1_p_team/);
    assert.doesNotMatch(r01.detail, /rh_1_p_org_b/);
  });

  void it("is not reproduced when every seeded project resolves a policy", () => {
    const r01 = finding(
      { resolution: [{ projectId: "p", privacy: true, retention: true, folded: true }] },
      "R01",
    );
    assert.equal(r01.verdict, VERDICT.notReproduced);
  });
});

void describe("R02, retention resolution and the trace fold", () => {
  /** @scenario "A head worker that throws ProjectNotFoundError reproduces R02" */
  void it("is reproduced with the count of lines and of dead-lettered jobs", () => {
    const r02 = finding(
      {
        headWorkerLog: [
          '{"level":"error","msg":"projection failed","err":"ProjectNotFoundError: rh_1_p_team"}',
          '{"level":"info","msg":"ok"}',
          '{"level":"warn","msg":"retrying ProjectNotFoundError"}',
        ].join("\n"),
        queuesSettled: ["{q}:gq:dlq:t1/agg:jobs", "3", "{q}:gq:group:t1/agg:jobs", "1"],
        resolution: [{ projectId: "p", privacy: false, retention: false, folded: false }],
      },
      "R02",
    );
    assert.equal(r02.verdict, VERDICT.reproduced);
    assert.match(r02.detail, /^2 ProjectNotFoundError lines/);
    assert.match(r02.detail, /3 jobs dead-lettered/);
  });
});

void describe("F-1, the roster's empty step list", () => {
  /** @scenario "A head roster row that declares no steps reproduces F-1" */
  void it("is reproduced and names the waiting steps", () => {
    const f1 = finding(
      {
        headImage: HEAD,
        roster: [
          { process_id: "w1", role: "worker", image: HEAD, steps: [] },
          { process_id: "old", role: "api", image: "langwatch/langwatch:3.20.1", steps: [] },
        ],
        steps: [
          { id: NOWG_STEP_IDS[0], status: "done" },
          { id: NOWG_STEP_IDS[1], status: "pending" },
        ],
      },
      "F-1",
    );
    assert.equal(f1.verdict, VERDICT.reproduced);
    assert.match(f1.detail, /^1 of 1 head roster rows/);
    assert.match(f1.detail, new RegExp(NOWG_STEP_IDS[1]));
    assert.doesNotMatch(f1.detail, new RegExp(`${NOWG_STEP_IDS[0]}(,|$)`));
  });

  void it("is not reproduced when head declares its steps and they are done", () => {
    const f1 = finding(
      {
        headImage: HEAD,
        roster: [{ image: HEAD, steps: ["user:record-created-facts"] }],
        steps: NOWG_STEP_IDS.map((id) => ({ id, status: "done" })),
      },
      "F-1",
    );
    assert.equal(f1.verdict, VERDICT.notReproduced);
  });
});

void describe("F-2, the SIGTERM drill", () => {
  const drill = (finishedAt) => ({
    signalAt: "2026-10-08T10:00:00.000Z",
    exitedAt: "2026-10-08T10:00:05.000Z",
    runningAtSignal: ["entitlement:seed-trace-meter"],
    after: [{ id: "entitlement:seed-trace-meter", status: "done", finished_at: finishedAt }],
  });

  /** @scenario "A step running at SIGTERM and recorded done before the worker exited reproduces F-2" */
  void it("is reproduced and names the step", () => {
    const f2 = finding({ drill: drill("2026-10-08T10:00:02.500Z") }, "F-2");
    assert.equal(f2.verdict, VERDICT.reproduced);
    assert.match(f2.detail, /recorded done between signal and exit: entitlement:seed-trace-meter/);
  });

  void it("is not reproduced when the step was left running", () => {
    const evidence = drill(null);
    evidence.after[0].status = "running";
    assert.equal(finding({ drill: evidence }, "F-2").verdict, VERDICT.notReproduced);
  });
});

void describe("Q09, jobs queued at the cut", () => {
  const cut = ["{q}:gq:group:t1/a:jobs", "4", "{q}:gq:group:t2/b:jobs", "2"];

  /** @scenario "Jobs queued at the cut that head drains settle Q09, and jobs it leaves reproduce it" */
  void it("is settled when head drains them and reproduced when it leaves, dead-letters or refuses them", () => {
    const base = {
      queuesCut: cut,
      headWorkerLog: '{"msg":"ok"}',
      headWorkerMetrics: "gq_jobs_unroutable_total 0\n",
    };
    assert.equal(finding({ ...base, queuesSettled: [] }, "Q09").verdict, VERDICT.settled);

    const left = finding({ ...base, queuesSettled: ["{q}:gq:group:t1/a:jobs", "4"] }, "Q09");
    assert.equal(left.verdict, VERDICT.reproduced);
    assert.match(left.detail, /4 still queued/);

    const dead = finding({ ...base, queuesSettled: ["{q}:gq:dlq:t1/a:jobs", "1"] }, "Q09");
    assert.equal(dead.verdict, VERDICT.reproduced);

    const refused = finding(
      { ...base, queuesSettled: [], headWorkerLog: "QueuedPayloadInvalidError: missing __routing" },
      "Q09",
    );
    assert.equal(refused.verdict, VERDICT.reproduced);

    const unroutable = finding(
      { ...base, queuesSettled: [], headWorkerMetrics: 'gq_jobs_unroutable_total{queue="q"} 2\n' },
      "Q09",
    );
    assert.equal(unroutable.verdict, VERDICT.reproduced);
  });
});

void describe("missing evidence", () => {
  /** @scenario "A finding with no evidence collected is inconclusive, never passed" */
  void it("is inconclusive and names what was missing", () => {
    const findings = evaluate({});
    assert.deepEqual(
      findings.map((f) => f.verdict),
      findings.map(() => VERDICT.inconclusive),
    );
    assert.match(findings.find((f) => f.id === "R01").detail, /resolution\.json/);
    assert.match(findings.find((f) => f.id === "Q09").detail, /queues-cut\.json/);
  });

  void it("is inconclusive for Q09 when nothing was queued at the cut", () => {
    const q09 = finding({ queuesCut: [], queuesSettled: [], headWorkerLog: "" }, "Q09");
    assert.equal(q09.verdict, VERDICT.inconclusive);
    assert.match(q09.detail, /jobs queued at the cut/);
  });
});

void describe("the queue listing and the report", () => {
  void it("separates pending from dead-lettered jobs per group", () => {
    const summary = summariseQueues({
      pairs: [
        "{a}:gq:group:t:1:jobs",
        "2",
        "{a}:gq:dlq:t:1:jobs",
        "5",
        "{a}:gq:group:t:2:jobs",
        "1",
      ],
    });
    assert.equal(summary.pendingTotal, 3);
    assert.equal(summary.deadLetteredTotal, 5);
    assert.equal(summary.pending.get("t:1"), 2);
  });

  void it("renders one row per finding and per ledger step", () => {
    const md = renderReport({
      run: { origin: "3.20.1", oldImage: "o", headImage: "h", order: "api-first", startedAt: "t" },
      findings: evaluate({}),
      steps: [{ id: "user:record-created-facts", mode: "background", status: "pending" }],
    });
    assert.match(md, /^# Upgrade rehearsal: 3\.20\.1 to head/);
    for (const id of ["R01", "R02", "F-1", "F-2", "Q09"])
      assert.match(md, new RegExp(`\\| ${id} \\|`));
    assert.match(md, /\| user:record-created-facts \| background \| pending \|/);
  });
});
