// A supervised lane restarts on a change and on a crash, and neither restart
// prepares (specs/setup/boot-sequence.feature). Real supervisor, a child that
// logs its starts, and a `pnpm` earlier on PATH that records every call: a
// restart that migrated would have to call it.

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

function startSupervised() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-supervisor-no-prepare-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(
    path.join(dir, "bin", "pnpm"),
    `#!/bin/sh\necho "$@" >> "${path.join(dir, "pnpm-calls.log")}"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(dir, "child.mjs"),
    `import fs from "node:fs";
fs.appendFileSync("events.log", "START\\n");
if (fs.existsSync("crash")) { process.exit(1); }
console.log("backend ready");
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
        PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`,
        LANGWATCH_DEV_WATCH_DIRS: "src",
        LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "50",
        LANGWATCH_DEV_GRACE_MS: "500",
        LANGWATCH_DEV_READY_PATTERN: "backend ready",
        LANGWATCH_DEV_HOLD_MARKER: path.join(dir, "no-marker"),
        LANGWATCH_DEV_CRASH_LOG: path.join(dir, "crash.log"),
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  const starts = () => {
    const file = path.join(dir, "events.log");
    return fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length
      : 0;
  };
  const prepared = () => fs.existsSync(path.join(dir, "pnpm-calls.log"));
  const touch = (name) => fs.writeFileSync(path.join(dir, "src", name), String(Date.now()));
  const stop = async () => {
    proc.kill("SIGTERM");
    await Promise.race([new Promise((r) => proc.on("close", r)), sleep(3000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, starts, prepared, touch, stop };
}

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await sleep(25);
  assert.ok(check(), "timed out waiting");
}

void describe("a supervised lane after a source change", () => {
  /** @scenario "A code change reloads a lane without migrating again" */
  void it("starts the process it supervises again and runs nothing else", async () => {
    const run = startSupervised();
    await until(() => run.starts() === 1);
    run.touch("a.ts");
    await until(() => run.starts() === 2);
    await sleep(200);

    assert.equal(run.starts(), 2);
    assert.equal(run.prepared(), false);
    await run.stop();
  });
});

void describe("a supervised lane that exited non-zero", () => {
  /** @scenario "A crash restart does not migrate again" */
  void it("comes back as the process it supervises and runs nothing else", async () => {
    const run = startSupervised();
    fs.writeFileSync(path.join(run.dir, "crash"), "");
    await until(() => run.starts() >= 1);
    await sleep(300);
    fs.rmSync(path.join(run.dir, "crash"));
    run.touch("a.ts");
    await until(() => run.starts() === 2);
    await sleep(200);

    assert.equal(run.starts(), 2);
    assert.equal(run.prepared(), false);
    await run.stop();
  });
});
