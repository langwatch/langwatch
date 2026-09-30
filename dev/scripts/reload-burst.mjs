#!/usr/bin/env node
/**
 * ADR-168's burst proof: an agent's write pattern against a fixture backend and
 * `dev-supervisor.mjs --watch`. Flags: --ref <git ref> (supervisor as committed),
 * --check (exit 1 on a failed scenario), --only a,b --edits N --boot-ms --takedown-ms.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const BOOT_MS = Number(value("boot-ms", 3_000));
const TAKEDOWN_MS = Number(value("takedown-ms", 500));
const edits = Number(value("edits", 40));

const CHILD = `
import fs from "node:fs";
import path from "node:path";
const log = (event) => fs.appendFileSync(process.env.EVENTS, \`\${Date.now()} \${process.pid} \${event}\\n\`);
const broken = () => fs.readdirSync("src").some((f) => fs.readFileSync(path.join("src", f), "utf8").includes("BROKEN"));
log("START");
process.on("SIGTERM", () => setTimeout(() => { log("STOP"); process.exit(0); }, ${TAKEDOWN_MS}));
if (broken()) setTimeout(() => { log("CRASH"); process.exit(1); }, 300);
else setTimeout(() => {
  log("READY");
  console.log(JSON.stringify({ msg: "backend ready" }));
}, ${BOOT_MS});
setInterval(() => {}, 1000);
`;

/** Each scenario writes through `write(file, text)`; `hold()` renews the agent-turn marker. */
const SCENARIOS = {
  storm: {
    doc: "200 edits over 20 files in 2 s",
    async run({ write }) {
      for (let i = 0; i < 200; i += 1) {
        write(`src/f${i % 20}.ts`, `export const v = ${i};\n`);
        await sleep(10);
      }
    },
    pass: (m) => m.restarts === 1 && !m.exited,
  },
  cadence: {
    doc: `${edits} edits, one per 1.5 s, no hold`,
    async run({ write }) {
      for (let i = 0; i < edits; i += 1) {
        write(`src/f${i % 20}.ts`, `export const v = ${i};\n`);
        await sleep(1_500);
      }
    },
    pass: (m) => m.maxConcurrent === 1 && !m.exited,
  },
  "cadence-hold": {
    doc: "30 edits, one per 1.5 s, hold renewed per edit then released (the hold caps at 60 s)",
    async run({ write, hold, release }) {
      for (let i = 0; i < 30; i += 1) {
        hold(5_000);
        write(`src/f${i % 20}.ts`, `export const v = ${i};\n`);
        await sleep(1_500);
      }
      release();
    },
    pass: (m) => m.restarts === 1 && m.maxConcurrent === 1 && !m.exited,
  },
  broken: {
    doc: "an import to a missing file, fixed 10 s later",
    async run({ write }) {
      write("src/f0.ts", 'import "./BROKEN";\n');
      await sleep(10_000);
      write("src/f0.ts", "export const v = 1;\n");
    },
    pass: (m) => !m.exited && m.recovered,
  },
  "non-code": {
    doc: "200 edits to .feature and .md files",
    async run({ write }) {
      for (let i = 0; i < 200; i += 1) {
        write(`src/s${i % 10}.${i % 2 === 0 ? "feature" : "md"}`, `line ${i}\n`);
        await sleep(10);
      }
    },
    pass: (m) => m.restarts === 0 && !m.exited,
  },
};

function supervisorSource() {
  const ref = value("ref", null);
  if (ref === null) return path.join(HERE, "dev-supervisor.mjs");
  const shown = spawnSync("git", ["show", `${ref}:dev/scripts/dev-supervisor.mjs`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (shown.status !== 0) throw new Error(`git show ${ref} failed: ${shown.stderr}`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reload-burst-sup-")), "sup.mjs");
  fs.writeFileSync(file, shown.stdout);
  return file;
}

const rssKiB = (pids) => {
  if (pids.length === 0) return 0;
  const out = spawnSync("ps", ["-o", "rss=", "-p", pids.join(",")], { encoding: "utf8" });
  return out.stdout
    .split("\n")
    .map((l) => Number.parseInt(l, 10))
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);
};

const readEvents = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [at, pid, event] = l.split(" ");
          return { at: Number(at), pid: Number(pid), event };
        })
    : [];

/** Children alive at once, from START to STOP or CRASH. */
function maxConcurrent(events) {
  let live = 0;
  let max = 0;
  for (const { event } of events) {
    if (event === "START") live += 1;
    if (event === "STOP" || event === "CRASH") live -= 1;
    max = Math.max(max, live);
  }
  return max;
}

/** An old supervisor leaks the children it overlapped; none of ours may outlive the run. */
function reapFixtures({ events, proc }) {
  const ended = new Set(
    events.filter((e) => e.event !== "START" && e.event !== "READY").map((e) => e.pid),
  );
  for (const { pid, event } of events) {
    if (event !== "START" || ended.has(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what the supervisor is meant to leave.
    }
  }
  proc.kill("SIGKILL");
}

async function runScenario({ name, scenario, supervisor }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `reload-burst-${name}-`));
  fs.mkdirSync(path.join(dir, "src"));
  for (let i = 0; i < 20; i += 1) fs.writeFileSync(path.join(dir, `src/f${i}.ts`), "");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  fs.writeFileSync(path.join(dir, "child.mjs"), CHILD);
  const events = path.join(dir, "events.log");
  const marker = path.join(dir, "marker");
  const proc = spawn(
    process.execPath,
    [supervisor, "--watch", "--", process.execPath, "child.mjs"],
    {
      cwd: dir,
      env: {
        ...process.env,
        EVENTS: events,
        LANGWATCH_DEV_WATCH_DIRS: "src",
        LANGWATCH_DEV_GRACE_MS: "3000",
        LANGWATCH_DEV_READY_PATTERN: "backend ready",
        LANGWATCH_DEV_HOLD_MARKER: marker,
        LANGWATCH_DEV_CRASH_LOG: path.join(dir, "crash.log"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  let exited = false;
  proc.stderr.on("data", (c) => (stderr += c));
  proc.on("close", () => (exited = true));

  let peak = 0;
  const sampler = setInterval(() => {
    const live = readEvents(events).filter((e, _, all) => {
      const ended = all.some((x) => x.pid === e.pid && (x.event === "STOP" || x.event === "CRASH"));
      return e.event === "START" && !ended;
    });
    peak = Math.max(peak, rssKiB([proc.pid, ...live.map((e) => e.pid)]));
  }, 250);

  while (!readEvents(events).some((e) => e.event === "READY")) await sleep(100);
  const writeApi = {
    write: (file, text) => fs.writeFileSync(path.join(dir, file), text),
    hold: (ms) => fs.writeFileSync(marker, String(Date.now() + ms)),
    release: () => fs.rmSync(marker, { force: true }),
  };
  const coldEvents = readEvents(events).length;
  await scenario.run(writeApi);
  const lastWriteAt = Date.now();
  const settleBy = lastWriteAt + 45_000;
  for (;;) {
    await sleep(250);
    const all = readEvents(events);
    const booting =
      all.filter((e) => e.event === "START").length >
      all.filter((e) => ["READY", "CRASH"].includes(e.event)).length;
    const idleMs = Date.now() - Math.max(lastWriteAt, all.at(-1)?.at ?? 0);
    if ((!booting && idleMs > 5_000 + TAKEDOWN_MS) || Date.now() > settleBy || exited) break;
  }
  clearInterval(sampler);
  const all = readEvents(events);
  const after = all.filter((e) => e.at >= lastWriteAt);
  const ready = after.find((e) => e.event === "READY");
  const metrics = {
    restarts: stderr.split("\n").filter((l) => l.includes("restarting (")).length,
    maxConcurrent: maxConcurrent(all),
    exited,
    serveMs: ready ? ready.at - lastWriteAt : null,
    peakRssMiB: Math.round(peak / 1024),
    recovered: all.at(-1)?.event === "READY",
    bootsAfterCold: all.slice(coldEvents).filter((e) => e.event === "START").length,
  };
  if (!exited) proc.kill("SIGTERM");
  await Promise.race([new Promise((r) => proc.on("close", r)), sleep(8_000)]);
  reapFixtures({ events: readEvents(events), proc });
  if (flag("events"))
    console.log(
      readEvents(events)
        .map((e) => `${e.at - lastWriteAt} ${e.pid} ${e.event}`)
        .join("\n"),
      "\n",
      stderr,
    );
  fs.rmSync(dir, { recursive: true, force: true });
  return metrics;
}

const only = value("only", null)?.split(",") ?? null;
const supervisor = supervisorSource();
const selected = Object.entries(SCENARIOS).filter(([name]) => only === null || only.includes(name));
const results = await Promise.all(
  selected.map(async ([name, scenario]) => [
    name,
    scenario,
    await runScenario({ name, scenario, supervisor }),
  ]),
);

let failed = 0;
console.log(
  `supervisor: ${value("ref", "working tree")}   (fixture boot ${BOOT_MS} ms, takedown ${TAKEDOWN_MS} ms)`,
);
console.log("scenario        restarts  max-live  exited  serve-ms  boots  peak-rss-MiB  pass");
for (const [name, scenario, m] of results) {
  const ok = scenario.pass(m);
  if (!ok) failed += 1;
  console.log(
    `${name.padEnd(15)} ${String(m.restarts).padStart(8)}  ${String(m.maxConcurrent).padStart(8)}  ${String(m.exited).padStart(6)}  ${String(m.serveMs ?? "-").padStart(8)}  ${String(m.bootsAfterCold).padStart(5)}  ${String(m.peakRssMiB).padStart(12)}  ${ok ? "yes" : "NO"}   ${scenario.doc}`,
  );
}
process.exitCode = flag("check") && failed > 0 ? 1 : 0;
