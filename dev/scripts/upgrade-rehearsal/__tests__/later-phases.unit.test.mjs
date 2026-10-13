// specs/upgrade/upgrade-rehearsal.feature: phases 3 to 7 over collected evidence, and their plan.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluate, peakMemory, rerunSteps, VERDICT } from "../evaluate.mjs";

const finding = (evidence, id) => evaluate(evidence).find((f) => f.id === id);
const step = (id, status, extra = {}) => ({
  id,
  status,
  attempt: 1,
  finished_at: "2026-10-09T10:00:00.000Z",
  ...extra,
});
const script = join(dirname(fileURLToPath(import.meta.url)), "..", "rehearse.sh");
const phasesOf = (args) => {
  const result = spawnSync("bash", [script, "--head-image", "h:1", "--plan-only", ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stderr: result.stderr,
    phases: /phases=(.*)/.exec(result.stdout)?.[1],
  };
};

void describe("planning the later phases", () => {
  /** @scenario "The plan names the phases each origin runs" */
  void it("runs rollback, re-upgrade and drills from an image, only the drills from empty", () => {
    assert.equal(phasesOf([]).phases, "0 1 2 3 4 5");
    assert.equal(phasesOf(["--through", "3"]).phases, "0 1 2 3");
    assert.equal(phasesOf(["--scale"]).phases, "0 1 2 3 4 5 6");
    assert.equal(phasesOf(["--origin", "empty"]).phases, "0 1 2 5");
    const refused = phasesOf(["--origin", "empty", "--through", "3"]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /no old image to roll back to/);
  });
});

void describe("ROLLBACK", () => {
  /** @scenario "A rollback that breaks only where the plan documents it passes, and any other break reproduces it" */
  void it("passes documented DEVELOPER reads and fails a missing column", () => {
    const run = { serving: true, smokeExit: 0, developerSeeded: true, preRosterExit: 0 };
    const documented =
      "Invalid value: Value 'DEVELOPER' not found; P2022 column \"role\" does not exist";
    assert.equal(
      finding({ rollbackRun: run, oldAppRollbackLog: documented }, "ROLLBACK").verdict,
      VERDICT.notReproduced,
    );
    const broken = finding(
      { rollbackRun: run, oldAppRollbackLog: 'column "auditId" does not exist' },
      "ROLLBACK",
    );
    assert.equal(broken.verdict, VERDICT.reproduced);
    assert.match(broken.detail, /1 undocumented/);
    assert.equal(
      finding({ rollbackRun: { ...run, smokeExit: 1 }, oldAppRollbackLog: "" }, "ROLLBACK").verdict,
      VERDICT.reproduced,
    );
  });
});

void describe("REUPGRADE", () => {
  /** @scenario "A re-upgrade after a rollback settles every step and names the steps that re-ran" */
  void it("names re-runs and reproduces on an unsettled step", () => {
    const before = [step("a:x", "done"), step("b:y", "done")];
    const after = [step("a:x", "done"), step("b:y", "done", { attempt: 2 })];
    assert.deepEqual(rerunSteps({ before, after }), ["b:y"]);
    const settled = finding(
      { reupgradeRun: { migrateExit: 0 }, stepsBeforeRollback: before, stepsReupgrade: after },
      "REUPGRADE",
    );
    assert.equal(settled.verdict, VERDICT.notReproduced);
    assert.match(settled.detail, /re-ran \(judge against each step's kind\): b:y/);
    const open = finding(
      {
        reupgradeRun: { migrateExit: 0 },
        stepsBeforeRollback: before,
        stepsReupgrade: [step("a:x", "failed")],
      },
      "REUPGRADE",
    );
    assert.equal(open.verdict, VERDICT.reproduced);
    assert.match(open.detail, /a:x \(failed\)/);
  });
});

void describe("phase 5 drills", () => {
  /** @scenario "Losing the runner lease stops the upgrade and a re-run resumes it" */
  void it("passes a refused run then a clean re-run, and is inconclusive when no lease was taken", () => {
    assert.equal(
      finding({ leaseDrill: { stolen: true, exit: 1, rerunExit: 0 } }, "LEASE").verdict,
      VERDICT.notReproduced,
    );
    assert.equal(
      finding({ leaseDrill: { stolen: true, exit: 0, rerunExit: 0 } }, "LEASE").verdict,
      VERDICT.reproduced,
    );
    assert.equal(
      finding({ leaseDrill: { stolen: false, exit: 0, rerunExit: 0 } }, "LEASE").verdict,
      VERDICT.inconclusive,
    );
  });

  /** @scenario "A second upgrade run that changes any step reproduces NO-OP" */
  void it("reproduces when a step's attempt moves", () => {
    const before = [step("a:x", "done")];
    const evidence = { noopRun: { exit: 0 }, stepsNoopBefore: before };
    assert.equal(
      finding({ ...evidence, stepsNoopAfter: before }, "NO-OP").verdict,
      VERDICT.notReproduced,
    );
    assert.equal(
      finding({ ...evidence, stepsNoopAfter: [step("a:x", "done", { attempt: 2 })] }, "NO-OP")
        .verdict,
      VERDICT.reproduced,
    );
  });

  /** @scenario "A step killed by SIGKILL that never settles reproduces SIGKILL" */
  void it("reproduces SIGKILL when the killed step never settles", () => {
    const killDrill = { runningAtSignal: ["a:x"], after: [step("a:x", "running")] };
    assert.equal(
      finding({ killDrill, stepsReupgrade: [step("a:x", "done")] }, "SIGKILL").verdict,
      VERDICT.notReproduced,
    );
    assert.equal(
      finding({ killDrill, stepsReupgrade: [step("a:x", "running")] }, "SIGKILL").verdict,
      VERDICT.reproduced,
    );
  });
});

void describe("TARGETS, SCALE and EVENTS", () => {
  /** @scenario "A private ClickHouse target behind the shared one reproduces TARGETS" */
  void it("reproduces when the private target lags or has no ledger rows", () => {
    const rows = [
      { step_id: "clickhouse:00200", target: "shared", status: "done" },
      { step_id: "clickhouse:00200", target: "private:rh_1_org_b", status: "done" },
    ];
    assert.equal(
      finding({ targetRows: rows, gooseTargets: { shared: 200, private: 200 } }, "TARGETS").verdict,
      VERDICT.notReproduced,
    );
    assert.equal(
      finding({ targetRows: rows, gooseTargets: { shared: 200, private: 150 } }, "TARGETS").verdict,
      VERDICT.reproduced,
    );
    assert.equal(
      finding({ targetRows: rows.slice(0, 1), gooseTargets: { shared: 1, private: 1 } }, "TARGETS")
        .verdict,
      VERDICT.reproduced,
    );
  });

  /** @scenario "Scale is measured but judged only against ruled bounds" */
  void it("reports the peak and stays inconclusive until bounds are given", () => {
    assert.deepEqual(
      peakMemory({ samples: "x-head-worker-1 512MiB / 8GiB\nx-head-worker-1 1.5GiB / 8GiB\n" }),
      { "x-head-worker-1": 1536 },
    );
    const evidence = {
      scaleRun: { projects: 10, users: 10 },
      memorySamples: "x-head-worker-1 900MiB / 8GiB",
      stepsSettled: [step("a:x", "done", { started_at: "2026-10-09T09:59:00.000Z" })],
    };
    const unbounded = finding(evidence, "SCALE");
    assert.equal(unbounded.verdict, VERDICT.inconclusive);
    assert.match(unbounded.detail, /peak 900 MiB; slowest step a:x 60s; no bound ruled/);
    const bounded = { ...evidence, bounds: { stepSeconds: 30, workerMemoryMiB: 2048 } };
    assert.equal(finding(bounded, "SCALE").verdict, VERDICT.reproduced);
  });

  void it("leaves EVENTS inconclusive until head can parse the exported event log", () => {
    assert.match(finding({}, "EVENTS").detail, /no stored-event parse command/);
  });
});
