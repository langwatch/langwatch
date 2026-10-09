#!/usr/bin/env node
// Turns a rehearsal run's evidence into findings and a report (plan 2026-10-08, F, phase 2).
// Pure over the evidence object; the CLI at the bottom reads <run-dir>/evidence and writes
// <run-dir>/report.json and <run-dir>/report.md. Missing evidence is inconclusive, never a pass.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_KINDS } from "./seed/product.mjs";

/** The background steps that wait for old writers to be gone (plan B.3, S02 to S06). */
export const NOWG_STEP_IDS = [
  "user:record-created-facts",
  "suite:replay-scenario-facts-for-open-runs",
  "workflow:record-current-version-fields",
  "licensing:copy-organization-licenses",
];

export const VERDICT = {
  reproduced: "reproduced",
  notReproduced: "not-reproduced",
  settled: "settled",
  inconclusive: "inconclusive",
};

const REFUSAL_PATTERN =
  /QueuedPayloadInvalidError|QueuedCommandPayloadInvalidError|UndeclaredQueuedEventTypeError|QueueTenantMismatchError/;

/** Lines of a log that match a pattern. */
export function matchingLines({ log, pattern }) {
  if (typeof log !== "string") return [];
  return log.split("\n").filter((line) => pattern.test(line));
}

/** Sums a redis `[key, size, ...]` listing into pending and dead-lettered jobs per group. */
export function summariseQueues({ pairs }) {
  const pending = new Map();
  const deadLettered = new Map();
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const key = String(pairs[i]);
    const size = Number(pairs[i + 1]) || 0;
    const dlq = /:gq:dlq:(.+):jobs$/.exec(key);
    const group = dlq ? null : /:gq:group:(.+):jobs$/.exec(key);
    if (dlq) deadLettered.set(dlq[1], (deadLettered.get(dlq[1]) ?? 0) + size);
    else if (group) pending.set(group[1], (pending.get(group[1]) ?? 0) + size);
  }
  const total = (map) => [...map.values()].reduce((sum, n) => sum + n, 0);
  return {
    pending,
    deadLettered,
    pendingTotal: total(pending),
    deadLetteredTotal: total(deadLettered),
  };
}

/** The value of each named counter in a Prometheus text exposition, summed over its labels. */
export function readCounters({ metrics, names }) {
  const out = Object.fromEntries(names.map((name) => [name, 0]));
  if (typeof metrics !== "string") return null;
  for (const line of metrics.split("\n")) {
    const match = /^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+([-+\d.eE]+)/.exec(line);
    if (match && match[1] in out) out[match[1]] += Number(match[2]);
  }
  return out;
}

const missing = (id, title, evidence) => ({
  id,
  title,
  verdict: VERDICT.inconclusive,
  detail: `evidence missing: ${evidence.join(", ")}`,
  evidence,
});

function r01({ resolution }) {
  const title = "Old projects do not resolve a data-privacy policy (captured content hidden)";
  if (!Array.isArray(resolution) || resolution.length === 0) {
    return missing("R01", title, ["resolution.json"]);
  }
  const without = resolution.filter((row) => !row.privacy).map((row) => row.projectId);
  return {
    id: "R01",
    title,
    verdict: without.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${without.length} of ${resolution.length} seeded projects do not resolve a privacy policy${without.length ? `: ${without.join(", ")}` : ""}`,
    evidence: ["resolution.json"],
  };
}

function r02({ resolution, headWorkerLog, queuesSettled }) {
  const title = "Trace projections throw ProjectNotFoundError for old projects";
  if (typeof headWorkerLog !== "string") return missing("R02", title, ["logs/head-worker.log"]);
  const thrown = matchingLines({ log: headWorkerLog, pattern: /ProjectNotFoundError/ }).length;
  const unresolved = Array.isArray(resolution)
    ? resolution.filter((row) => !row.retention || !row.folded).length
    : null;
  const dead = queuesSettled ? summariseQueues({ pairs: queuesSettled }).deadLetteredTotal : null;
  return {
    id: "R02",
    title,
    verdict: thrown > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${thrown} ProjectNotFoundError lines on the head worker; ${dead ?? "unknown"} jobs dead-lettered when phase 2 ended (the 2.6 h retry window may not have elapsed); ${unresolved ?? "unknown"} seeded projects without a resolved retention or a folded trace`,
    evidence: ["logs/head-worker.log", "queues-settled.json", "resolution.json"],
  };
}

function f1({ roster, steps, headImage }) {
  const title = "The serving roster declares no steps, so needs-old-writers-gone steps never run";
  if (!Array.isArray(roster) || !Array.isArray(steps)) {
    return missing("F-1", title, ["ledger-roster.json", "ledger-steps.json"]);
  }
  const head = roster.filter((row) => !headImage || row.image === headImage);
  const empty = head.filter((row) => !Array.isArray(row.steps) || row.steps.length === 0);
  const waiting = NOWG_STEP_IDS.filter((id) => {
    const row = steps.find((step) => step.id === id);
    return !row || (row.status !== "done" && row.status !== "not-needed");
  });
  if (head.length === 0) return missing("F-1", title, ["a head row in ledger-roster.json"]);
  return {
    id: "F-1",
    title,
    verdict: empty.length > 0 && waiting.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${empty.length} of ${head.length} head roster rows declare no steps; not done when phase 2 ended: ${waiting.join(", ") || "none"}`,
    evidence: ["ledger-roster.json", "ledger-steps.json"],
  };
}

function f2({ drill }) {
  const title = "A step stopped by SIGTERM mid-run is recorded done";
  if (!drill || !Array.isArray(drill.after)) return missing("F-2", title, ["f2-drill.json"]);
  const running = drill.runningAtSignal ?? [];
  if (running.length === 0) {
    return {
      ...missing("F-2", title, ["a step running at the signal"]),
      evidence: ["f2-drill.json"],
    };
  }
  const signalAt = Date.parse(drill.signalAt);
  const exitedAt = Date.parse(drill.exitedAt);
  const doneEarly = drill.after.filter((step) => {
    const finished = Date.parse(step.finished_at);
    return (
      running.includes(step.id) &&
      step.status === "done" &&
      finished >= signalAt &&
      finished <= exitedAt
    );
  });
  return {
    id: "F-2",
    title,
    verdict: doneEarly.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `running at SIGTERM: ${running.join(", ")}; recorded done between signal and exit: ${doneEarly.map((s) => s.id).join(", ") || "none"}`,
    evidence: ["f2-drill.json"],
  };
}

function q09({ queuesCut, queuesSettled, headWorkerLog, headWorkerMetrics }) {
  const title = "Head workers process the jobs the old image queued before the cut";
  if (!queuesCut || !queuesSettled || typeof headWorkerLog !== "string") {
    return missing("Q09", title, [
      "queues-cut.json",
      "queues-settled.json",
      "logs/head-worker.log",
    ]);
  }
  const cut = summariseQueues({ pairs: queuesCut });
  const settled = summariseQueues({ pairs: queuesSettled });
  if (cut.pendingTotal === 0) {
    return { ...missing("Q09", title, ["jobs queued at the cut"]), evidence: ["queues-cut.json"] };
  }
  const left = [...cut.pending.keys()].reduce((sum, g) => sum + (settled.pending.get(g) ?? 0), 0);
  const newlyDead = settled.deadLetteredTotal - cut.deadLetteredTotal;
  const refusals = matchingLines({ log: headWorkerLog, pattern: REFUSAL_PATTERN }).length;
  const counters = readCounters({
    metrics: headWorkerMetrics,
    names: ["gq_jobs_unroutable_total", "gq_jobs_non_retryable_total", "gq_jobs_exhausted_total"],
  });
  const unroutable = counters?.gq_jobs_unroutable_total ?? 0;
  const failed = left > 0 || newlyDead > 0 || refusals > 0 || unroutable > 0;
  return {
    id: "Q09",
    title,
    verdict: failed ? VERDICT.reproduced : VERDICT.settled,
    detail: `${cut.pendingTotal} jobs in ${cut.pending.size} groups at the cut; ${left} still queued, ${newlyDead} newly dead-lettered, ${refusals} refusal lines, ${counters ? unroutable : "unscraped"} unroutable`,
    evidence: [
      "queues-cut.json",
      "queues-settled.json",
      "logs/head-worker.log",
      "head-worker.metrics",
    ],
  };
}

const SETTLED_STATUSES = new Set(["done", "not-needed"]);
const SCHEMA_MISSING = /(column|relation) "[^"]+" does not exist|P2021|P2022|Code: (47|60)\./;
/** Read breaks the plan documents for a rollback (P16 not_onboarded, P31 DEVELOPER). */
const DOCUMENTED_ROLLBACK_BREAK = /not_onboarded|DEVELOPER/;

/** Steps of a ledger snapshot that are not done or not-needed, as `id (status)`. */
export function unsettledSteps({ steps }) {
  return steps.filter((s) => !SETTLED_STATUSES.has(s.status)).map((s) => `${s.id} (${s.status})`);
}

/** Steps finished before `before` whose finish or attempt moved by `after`: they re-ran. */
export function rerunSteps({ before, after }) {
  return after
    .filter((step) => {
      const was = before.find((s) => s.id === step.id);
      return (
        was?.status === "done" &&
        (step.finished_at !== was.finished_at || step.attempt !== was.attempt)
      );
    })
    .map((step) => step.id);
}

/** Peak MiB per container over `docker stats` samples (`<name> <usage> / <limit>` lines). */
export function peakMemory({ samples }) {
  const unit = { B: 1 / 1048576, KiB: 1 / 1024, kB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 };
  const peaks = {};
  for (const line of samples.split("\n")) {
    const match = /^(\S+)\s+([\d.]+)([A-Za-z]+)\s*\//.exec(line);
    if (!match || !(match[3] in unit)) continue;
    const mib = Number(match[2]) * unit[match[3]];
    peaks[match[1]] = Math.max(peaks[match[1]] ?? 0, mib);
  }
  return peaks;
}

function rollback({ rollbackRun, oldAppRollbackLog, oldWorkerRollbackLog }) {
  const title = "The old image serves head's schema after a rollback, with only P16/P17/P31 breaks";
  if (!rollbackRun || typeof oldAppRollbackLog !== "string") {
    return missing("ROLLBACK", title, ["rollback.json", "logs/old-app-rollback.log"]);
  }
  const lines = [oldAppRollbackLog, oldWorkerRollbackLog ?? ""].flatMap((log) =>
    matchingLines({ log, pattern: SCHEMA_MISSING }),
  );
  const documented = lines.filter((l) => DOCUMENTED_ROLLBACK_BREAK.test(l)).length;
  const undocumented = lines.length - documented;
  const failed = !rollbackRun.serving || rollbackRun.smokeExit !== 0 || undocumented > 0;
  return {
    id: "ROLLBACK",
    title,
    verdict: failed ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `old api ${rollbackRun.serving ? "served" : "refused"}; smoke exit ${rollbackRun.smokeExit}; ${undocumented} undocumented and ${documented} documented schema-read errors; DEVELOPER rows ${rollbackRun.developerSeeded ? "written" : "not written"}; pre-roster-rollback exit ${rollbackRun.preRosterExit}`,
    evidence: ["rollback.json", "logs/old-app-rollback.log", "logs/old-worker-rollback.log"],
  };
}

function reupgrade({
  reupgradeRun,
  stepsBeforeRollback,
  stepsReupgrade,
  queuesRollback,
  queuesReupgrade,
}) {
  const title =
    "Re-upgrading after a rollback settles every step and drains what the rollback left";
  if (!reupgradeRun || !Array.isArray(stepsBeforeRollback) || !Array.isArray(stepsReupgrade)) {
    return missing("REUPGRADE", title, [
      "reupgrade.json",
      "ledger-steps-before-rollback.json",
      "ledger-steps-reupgrade.json",
    ]);
  }
  const unsettled = unsettledSteps({ steps: stepsReupgrade });
  const reran = rerunSteps({ before: stepsBeforeRollback, after: stepsReupgrade });
  const left =
    queuesRollback && queuesReupgrade
      ? (() => {
          const at = summariseQueues({ pairs: queuesRollback });
          const end = summariseQueues({ pairs: queuesReupgrade });
          return [...at.pending.keys()].reduce((sum, g) => sum + (end.pending.get(g) ?? 0), 0);
        })()
      : null;
  const failed = reupgradeRun.migrateExit !== 0 || unsettled.length > 0 || (left ?? 0) > 0;
  return {
    id: "REUPGRADE",
    title,
    verdict: failed ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `upgrade exit ${reupgradeRun.migrateExit}; unsettled: ${unsettled.join(", ") || "none"}; re-ran (judge against each step's kind): ${reran.join(", ") || "none"}; ${left ?? "unknown"} jobs left from the rollback's groups`,
    evidence: [
      "reupgrade.json",
      "ledger-steps-reupgrade.json",
      "queues-rollback.json",
      "queues-reupgrade.json",
    ],
  };
}

function noop({ noopRun, stepsNoopBefore, stepsNoopAfter }) {
  const title = "A second upgrade run applies nothing";
  if (!noopRun || !Array.isArray(stepsNoopBefore) || !Array.isArray(stepsNoopAfter)) {
    return missing("NO-OP", title, [
      "noop.json",
      "ledger-steps-noop-before.json",
      "ledger-steps-noop-after.json",
    ]);
  }
  const moved = stepsNoopAfter
    .filter((step) => {
      const was = stepsNoopBefore.find((s) => s.id === step.id);
      return (
        !was ||
        was.status !== step.status ||
        was.attempt !== step.attempt ||
        was.finished_at !== step.finished_at
      );
    })
    .map((step) => step.id);
  return {
    id: "NO-OP",
    title,
    verdict: noopRun.exit !== 0 || moved.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `second run exit ${noopRun.exit}; steps changed by it: ${moved.join(", ") || "none"}`,
    evidence: ["noop.json", "ledger-steps-noop-before.json", "ledger-steps-noop-after.json"],
  };
}

function sigkill({ killDrill, stepsReupgrade }) {
  const title = "A step killed by SIGKILL mid-run is never done early and settles after restart";
  if (!killDrill || !Array.isArray(killDrill.after) || !Array.isArray(stepsReupgrade)) {
    return missing("SIGKILL", title, ["kill-drill.json", "ledger-steps-reupgrade.json"]);
  }
  const running = killDrill.runningAtSignal ?? [];
  if (running.length === 0)
    return {
      ...missing("SIGKILL", title, ["a step running at the signal"]),
      evidence: ["kill-drill.json"],
    };
  const early = killDrill.after
    .filter((s) => running.includes(s.id) && s.status === "done")
    .map((s) => s.id);
  const stuck = unsettledSteps({ steps: stepsReupgrade.filter((s) => running.includes(s.id)) });
  return {
    id: "SIGKILL",
    title,
    verdict: early.length > 0 || stuck.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `running at SIGKILL: ${running.join(", ")}; done at the kill: ${early.join(", ") || "none"}; unsettled after restart: ${stuck.join(", ") || "none"} (checkpoint resume is read from the step's report by hand)`,
    evidence: ["kill-drill.json", "ledger-steps-reupgrade.json"],
  };
}

function lease({ leaseDrill }) {
  const title = "Losing the runner lease inside upgrade stops it, and a re-run resumes";
  if (!leaseDrill) return missing("LEASE", title, ["lease-drill.json"]);
  if (!leaseDrill.stolen)
    return {
      ...missing("LEASE", title, ["a lease held while the upgrade ran"]),
      evidence: ["lease-drill.json"],
    };
  const failed = leaseDrill.exit === 0 || leaseDrill.rerunExit !== 0;
  return {
    id: "LEASE",
    title,
    verdict: failed ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `upgrade exit ${leaseDrill.exit} after its lease was taken (expect non-zero); re-run exit ${leaseDrill.rerunExit} (expect 0)`,
    evidence: ["lease-drill.json", "logs/head-migrate-lease.log"],
  };
}

function targets({ targetRows, gooseTargets }) {
  const title = "Every ClickHouse target, the private route included, is migrated to head";
  if (!Array.isArray(targetRows) || !gooseTargets)
    return missing("TARGETS", title, ["ledger-targets.json", "goose-targets.json"]);
  const privateRows = targetRows.filter((row) => String(row.target).startsWith("private"));
  const open = targetRows
    .filter((row) => !SETTLED_STATUSES.has(row.status))
    .map((row) => `${row.step_id}@${row.target}`);
  const behind = gooseTargets.shared == null || gooseTargets.private !== gooseTargets.shared;
  return {
    id: "TARGETS",
    title,
    verdict:
      privateRows.length === 0 || open.length > 0 || behind
        ? VERDICT.reproduced
        : VERDICT.notReproduced,
    detail: `${privateRows.length} private-target ledger rows; goose shared ${gooseTargets.shared}, private ${gooseTargets.private}; not done: ${open.join(", ") || "none"}`,
    evidence: ["ledger-targets.json", "goose-targets.json"],
  };
}

function scale({ scaleRun, memorySamples, bounds, stepsSettled }) {
  const title = "At scale, each step and the head worker stay within the ruled bounds";
  if (!scaleRun) return missing("SCALE", title, ["scale.json (run with --scale)"]);
  if (typeof memorySamples !== "string" || !Array.isArray(stepsSettled))
    return missing("SCALE", title, ["memory.log", "ledger-steps.json"]);
  const peaks = peakMemory({ samples: memorySamples });
  const worker = Math.max(
    0,
    ...Object.entries(peaks)
      .filter(([n]) => n.includes("head-worker"))
      .map(([, v]) => v),
  );
  const seconds = Object.fromEntries(
    stepsSettled
      .filter((s) => s.started_at && s.finished_at)
      .map((s) => [s.id, (Date.parse(s.finished_at) - Date.parse(s.started_at)) / 1000]),
  );
  const slowest = Object.entries(seconds).toSorted((a, b) => b[1] - a[1])[0];
  const measured = `head worker peak ${Math.round(worker)} MiB; slowest step ${slowest ? `${slowest[0]} ${slowest[1]}s` : "none"}`;
  if (!bounds)
    return {
      ...missing("SCALE", title, ["bounds.json (no bound ruled yet)"]),
      detail: `${measured}; no bound ruled, so nothing is judged`,
    };
  const over = Object.entries(seconds)
    .filter(([, s]) => s > bounds.stepSeconds)
    .map(([id]) => id);
  return {
    id: "SCALE",
    title,
    verdict:
      worker > bounds.workerMemoryMiB || over.length > 0
        ? VERDICT.reproduced
        : VERDICT.notReproduced,
    detail: `${measured}; over ${bounds.stepSeconds}s: ${over.join(", ") || "none"}; memory bound ${bounds.workerMemoryMiB} MiB`,
    evidence: ["scale.json", "memory.log", "ledger-steps.json", "bounds.json"],
  };
}

function events({ eventParse }) {
  const title =
    "Every event_log row written by the old image parses with head's schemas and upcasts";
  if (!eventParse)
    return missing("EVENTS", title, [
      "event-parse.json (head has no stored-event parse command yet)",
    ]);
  return {
    id: "EVENTS",
    title,
    verdict: eventParse.refused > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${eventParse.parsed} rows parsed, ${eventParse.refused} refused`,
    evidence: ["event-log.jsonl", "event-parse.json"],
  };
}

/** One finding per product kind: seeded on the old image, then read back through head. */
function products({ productSeeds, productReadback }) {
  return PRODUCT_KINDS.map(({ kind }) => {
    const id = `SEED-${kind}`;
    const title = `A ${kind} seeded through the old image reads back through head`;
    const seed = productSeeds?.kinds?.find((each) => each.kind === kind);
    if (!seed) return missing(id, title, ["product-seeds.json"]);
    if (!seed.seeded) {
      return {
        ...missing(id, title, ["product-seeds.json"]),
        detail: `not seeded: ${seed.reason}`,
      };
    }
    const read = productReadback?.kinds?.find((each) => each.kind === kind);
    if (!read) return missing(id, title, ["product-readback.json"]);
    return {
      id,
      title,
      verdict: read.found ? VERDICT.notReproduced : VERDICT.reproduced,
      detail: `${read.found ? "read back" : "missing on head"}${read.created === undefined ? "" : ` (${read.foundCount} of ${read.created})`}${read.error ? `: ${read.error}` : ""}`,
      evidence: ["product-seeds.json", "product-readback.json"],
    };
  });
}

/** Every span the old api accepted is stored by the time head settles. */
function spans({ spanCounts }) {
  const title = "Every span accepted through the old api is stored after the upgrade";
  if (!spanCounts) return missing("SPANS", title, ["spans.json"]);
  const lost = spanCounts.stored < spanCounts.sent;
  return {
    id: "SPANS",
    title,
    verdict: lost ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${spanCounts.stored} of ${spanCounts.sent} accepted spans stored`,
    evidence: ["spans.json", "ingest.log"],
  };
}

/** Every finding the rehearsal reports, in plan order. */
export function evaluate(evidence) {
  return [
    r01(evidence),
    r02(evidence),
    f1(evidence),
    f2(evidence),
    q09(evidence),
    targets(evidence),
    rollback(evidence),
    reupgrade(evidence),
    lease(evidence),
    sigkill(evidence),
    noop(evidence),
    scale(evidence),
    events(evidence),
    spans(evidence),
    ...products(evidence),
  ];
}

/** The report as Markdown, one table row per finding plus the ledger's step statuses. */
export function renderReport({ run, findings, steps }) {
  const rows = findings.map((f) => `| ${f.id} | ${f.verdict} | ${f.title} | ${f.detail} |`);
  const ledger = Array.isArray(steps)
    ? steps.map((s) => `| ${s.id} | ${s.mode ?? ""} | ${s.status} | ${s.last_error ?? ""} |`)
    : ["| (ledger not collected) | | | |"];
  return [
    `# Upgrade rehearsal: ${run.origin} to head`,
    "",
    `Old image: ${run.oldImage ?? "none"}. Head image: ${run.headImage}. Stop order: ${run.order}. Started ${run.startedAt}.`,
    "",
    "| Finding | Verdict | What | Evidence |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "| Step | Mode | Status | Last error |",
    "| --- | --- | --- | --- |",
    ...ledger,
    "",
  ].join("\n");
}

function readEvidence({ dir }) {
  const json = (name) =>
    existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), "utf8")) : undefined;
  const text = (name) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : undefined;
  const run = json("run.json") ?? {};
  return {
    run,
    headImage: run.headImage,
    resolution: json("resolution.json"),
    steps: json("ledger-steps.json"),
    roster: json("ledger-roster.json"),
    drill: json("f2-drill.json"),
    queuesCut: json("queues-cut.json"),
    queuesSettled: json("queues-settled.json"),
    headWorkerLog: text("logs/head-worker.log"),
    headWorkerMetrics: text("head-worker.metrics"),
    targetRows: json("ledger-targets.json"),
    gooseTargets: json("goose-targets.json"),
    rollbackRun: json("rollback.json"),
    oldAppRollbackLog: text("logs/old-app-rollback.log"),
    oldWorkerRollbackLog: text("logs/old-worker-rollback.log"),
    reupgradeRun: json("reupgrade.json"),
    stepsBeforeRollback: json("ledger-steps-before-rollback.json"),
    stepsReupgrade: json("ledger-steps-reupgrade.json"),
    queuesRollback: json("queues-rollback.json"),
    queuesReupgrade: json("queues-reupgrade.json"),
    leaseDrill: json("lease-drill.json"),
    killDrill: json("kill-drill.json"),
    noopRun: json("noop.json"),
    stepsNoopBefore: json("ledger-steps-noop-before.json"),
    stepsNoopAfter: json("ledger-steps-noop-after.json"),
    scaleRun: json("scale.json"),
    memorySamples: text("memory.log"),
    bounds: json("bounds.json"),
    stepsSettled: json("ledger-steps.json"),
    eventParse: json("event-parse.json"),
    productSeeds: json("product-seeds.json"),
    productReadback: json("product-readback.json"),
    spanCounts: json("spans.json"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) {
    process.stderr.write("usage: evaluate.mjs <run-dir>\n");
    process.exit(2);
  }
  const evidence = readEvidence({ dir: join(runDir, "evidence") });
  const findings = evaluate(evidence);
  writeFileSync(
    join(runDir, "report.json"),
    `${JSON.stringify({ run: evidence.run, findings }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "report.md"),
    renderReport({ run: evidence.run, findings, steps: evidence.steps }),
  );
  for (const f of findings)
    process.stdout.write(`${f.id.padEnd(4)} ${f.verdict.padEnd(15)} ${f.detail}\n`);
}
