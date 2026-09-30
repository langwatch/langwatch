// The watched child's reload lifecycle end to end (specs/setup/dev-process-topology.feature):
// a crashed boot waits, a change during a boot queues one follow-up. Real
// supervisor, throwaway fixture child, a scratch directory as the only watch root.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SUPERVISOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dev-supervisor.mjs",
);

/** A child that logs START, then READY after `bootMs`, or exits 1 while `crash` exists. */
function startSupervised({ bootMs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-supervisor-reload-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "child.mjs"),
    `import fs from "node:fs";
const log = (e) => fs.appendFileSync("events.log", e + "\\n");
log("START");
if (fs.existsSync("crash")) { process.exit(1); }
setTimeout(() => { log("READY"); console.log("backend ready"); }, ${bootMs});
setInterval(() => {}, 1000);
`,
  );
  const proc = spawn(
    process.execPath,
    [SUPERVISOR, "--watch", "--", process.execPath, "child.mjs"],
    {
      cwd: dir,
      env: {
        ...process.env,
        LANGWATCH_DEV_WATCH_DIRS: "src",
        LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "50",
        LANGWATCH_DEV_GRACE_MS: "500",
        LANGWATCH_DEV_READY_PATTERN: "backend ready",
        LANGWATCH_DEV_HOLD_MARKER: path.join(dir, "no-marker"),
        LANGWATCH_DEV_CRASH_LOG: path.join(dir, "crash.log"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  let closed = false;
  proc.stderr.on("data", (chunk) => (stderr += chunk));
  proc.on("close", () => (closed = true));
  const events = () => {
    const file = path.join(dir, "events.log");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };
  const touch = (name) => fs.writeFileSync(path.join(dir, "src", name), String(Date.now()));
  const stop = async () => {
    proc.kill("SIGTERM");
    await Promise.race([new Promise((r) => proc.on("close", r)), sleep(3000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, events, touch, stop, stderr: () => stderr, closed: () => closed };
}

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await sleep(25);
  assert.ok(check(), "timed out waiting");
}

void describe("a watched child that crashes", () => {
  /** @scenario "A crashed boot waits for the next change instead of ending the lane" */
  void it("stays supervised, says so once, and boots again on the next change", async () => {
    const run = startSupervised({ bootMs: 100 });
    fs.writeFileSync(path.join(run.dir, "crash"), "");
    await until(() => run.events().length > 0);
    await until(() => run.stderr().includes("waiting for the next change"));
    await sleep(300);
    assert.equal(run.closed(), false);
    assert.equal(run.stderr().split("waiting for the next change").length - 1, 1);

    fs.rmSync(path.join(run.dir, "crash"));
    run.touch("a.ts");
    await until(() => run.events().includes("READY"));
    assert.equal(run.closed(), false);
    await run.stop();
  });
});

void describe("a change while the child is booting", () => {
  /** @scenario "Changes during a reload queue exactly one follow-up" */
  void it("waits for the boot to settle, then reloads once for everything that arrived", async () => {
    const run = startSupervised({ bootMs: 700 });
    await until(() => run.events().length === 1);
    run.touch("a.ts");
    await sleep(200);
    run.touch("b.ts");
    await sleep(200);
    run.touch("c.ts");
    await until(() => run.events().filter((e) => e === "READY").length === 2, 8000);
    await sleep(300);
    assert.deepEqual(run.events(), ["START", "READY", "START", "READY"]);
    assert.equal(run.stderr().split("restarting (").length - 1, 1);
    await run.stop();
  });
});
