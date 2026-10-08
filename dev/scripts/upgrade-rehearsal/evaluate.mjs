#!/usr/bin/env node
// Turns a rehearsal run's evidence into findings and a report (plan 2026-10-08, F, phase 2).
// Pure over the evidence object; the CLI at the bottom reads <run-dir>/evidence and writes
// <run-dir>/report.json and <run-dir>/report.md. Missing evidence is inconclusive, never a pass.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

function r01({ scope }) {
  const title = "Old projects have no data-privacy scope row (captured content hidden)";
  if (!Array.isArray(scope) || scope.length === 0) return missing("R01", title, ["scope.json"]);
  const without = scope.filter((row) => !row.privacy).map((row) => row.projectId);
  return {
    id: "R01",
    title,
    verdict: without.length > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${without.length} of ${scope.length} seeded projects have no DataPrivacyProjectScope row${without.length ? `: ${without.join(", ")}` : ""}`,
    evidence: ["scope.json"],
  };
}

function r02({ scope, headWorkerLog, queuesSettled }) {
  const title = "Trace projections throw ProjectNotFoundError for old projects";
  if (typeof headWorkerLog !== "string") return missing("R02", title, ["logs/head-worker.log"]);
  const thrown = matchingLines({ log: headWorkerLog, pattern: /ProjectNotFoundError/ }).length;
  const withoutRetention = Array.isArray(scope)
    ? scope.filter((row) => !row.retention).length
    : null;
  const dead = queuesSettled ? summariseQueues({ pairs: queuesSettled }).deadLetteredTotal : null;
  return {
    id: "R02",
    title,
    verdict: thrown > 0 ? VERDICT.reproduced : VERDICT.notReproduced,
    detail: `${thrown} ProjectNotFoundError lines on the head worker; ${dead ?? "unknown"} jobs dead-lettered when phase 2 ended (the 2.6 h retry window may not have elapsed); ${withoutRetention ?? "unknown"} seeded projects without a DataRetentionProjectScope row`,
    evidence: ["logs/head-worker.log", "queues-settled.json", "scope.json"],
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

/** Every finding the rehearsal reports, in plan order. */
export function evaluate(evidence) {
  return [r01(evidence), r02(evidence), f1(evidence), f2(evidence), q09(evidence)];
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
    scope: json("scope.json"),
    steps: json("ledger-steps.json"),
    roster: json("ledger-roster.json"),
    drill: json("f2-drill.json"),
    queuesCut: json("queues-cut.json"),
    queuesSettled: json("queues-settled.json"),
    headWorkerLog: text("logs/head-worker.log"),
    headWorkerMetrics: text("head-worker.metrics"),
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
