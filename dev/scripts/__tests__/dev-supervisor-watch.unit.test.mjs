// Unit tests for the `--watch` debounce/ignore logic and the SIGTERM-wait-
// SIGKILL drain primitive (specs/setup/dev-process-topology.feature).
// Exercises exported functions directly, spawning only a throwaway fixture
// script standing in for a draining process, never the real api/worker.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createBackendFilter,
  createDebouncer,
  createReloadQueue,
  holdRemainingMs,
  resolveBundleConfig,
  resolveWatchConfig,
  shouldIgnoreWatchPath,
  stackControls,
} from "../dev-supervisor.mjs";

/**
 * Prints READY once its SIGTERM handler is installed, then on SIGTERM
 * waits `drainMs` (standing in for in-flight work) before exiting — never
 * SIGKILL-proof, so the test observes whether it got time to finish.
 */
function spawnDrainingChild(drainMs) {
  return spawn(
    process.execPath,
    [
      "-e",
      `process.on("SIGTERM", () => { setTimeout(() => { console.log("DRAINED"); process.exit(0); }, ${drainMs}); });` +
        `console.log("READY");` +
        `setInterval(() => {}, 1000);`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
}

/** Resolves once `child`'s stdout has produced a line matching `pattern`. */
function waitForOutput(child, pattern) {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      if (pattern.test(buffer)) {
        child.stdout.off("data", onData);
        resolve(buffer);
      }
    };
    child.stdout.on("data", onData);
  });
}

void describe("shouldIgnoreWatchPath", () => {
  void it("ignores a __tests__ directory", () => {
    assert.equal(shouldIgnoreWatchPath("src/__tests__/foo.unit.test.ts"), true);
  });

  void it("ignores a *.test.ts file outside __tests__", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/src/foo.test.ts"), true);
  });

  void it("ignores a *.spec.tsx file", () => {
    assert.equal(shouldIgnoreWatchPath("src/foo.spec.tsx"), true);
  });

  void it("ignores an editor temp file written beside its target", () => {
    assert.equal(
      shouldIgnoreWatchPath("../../modules/trace/process/src/a.ts.tmp.17938.dfd323429215"),
      true,
    );
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/src/a.ts"), false);
  });

  void it("ignores a test suite's scratch directory beside the package", () => {
    assert.equal(
      shouldIgnoreWatchPath("../../packages/api/.tmp-rest-handler-tQBUui/fixture.ts"),
      true,
    );
    assert.equal(shouldIgnoreWatchPath("../../packages/api/.tmp-rest-handler-tQBUui"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/api/src/rest/pipeline.ts"), false);
  });

  // /** @scenario "A browser-half edit leaves the backend lane alone" */
  void it("ignores a module's browser half, which the backend cannot import", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/browser/src/ui/a.tsx"), true);
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/browser/package.json"), true);
    assert.equal(
      shouldIgnoreWatchPath("../../enterprise/modules/governance/browser/src/a.tsx"),
      true,
    );
  });

  void it("still restarts on the halves the backend does import", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/src/a.ts"), false);
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/contract/src/a.ts"), false);
    assert.equal(shouldIgnoreWatchPath("../../packages/kernel/src/a.ts"), false);
  });

  /** @scenario "A build tool's own temp config leaves the backend lane alone" */
  void it("ignores a build tool's bundled config written beside the package", () => {
    assert.equal(shouldIgnoreWatchPath("../../packages/ksuid/tsup.config.bundled_py25.mjs"), true);
    assert.equal(
      shouldIgnoreWatchPath("../../packages/ksuid/vite.config.ts.timestamp-1758.mjs"),
      true,
    );
    assert.equal(shouldIgnoreWatchPath("../../packages/ksuid/tsup.config.ts"), false);
  });

  /** @scenario "An agent's import-graph probe leaves the backend lane alone" */
  void it("ignores an agent's import-graph probe written into a source directory", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/__probe_lw_full.ts"), true);
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/src/__probe__.ts"), true);
    assert.equal(
      shouldIgnoreWatchPath("../../modules/trace/process/src/__escape_probe__.ts"),
      true,
    );
    // A real file that merely mentions the word is still a restart.
    assert.equal(shouldIgnoreWatchPath("../../packages/kernel/src/probe.ts"), false);
  });

  void it("ignores dist and generated churn", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/dist/index.js"), true);
    assert.equal(shouldIgnoreWatchPath("src/generated/types.ts"), true);
  });

  void it("ignores tsbuildinfo and node_modules churn", () => {
    assert.equal(shouldIgnoreWatchPath("src/.tsbuildinfo"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/foo/node_modules/bar/index.js"), true);
  });

  void it("does not ignore an ordinary source file", () => {
    assert.equal(shouldIgnoreWatchPath("src/api.entrypoint.ts"), false);
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/process/src/trace.service.ts"), false);
  });
});

void describe("resolveWatchConfig", () => {
  // The modules and enterprise trees joined the set in d194dc1a37: before that
  // a week of module edits never restarted the backend and every fix read as
  // unfixed. This assertion was left behind by that change.
  void it("defaults to the package, module and enterprise trees with a 2s window", () => {
    const config = resolveWatchConfig({});
    assert.deepEqual(config.dirs, ["src", "../../packages", "../../modules", "../../enterprise"]);
    assert.equal(config.debounceMs, 2000);
  });

  void it("reads an override for both the dirs and the debounce window", () => {
    const config = resolveWatchConfig({
      LANGWATCH_DEV_WATCH_DIRS: "src, ../../modules/trace ",
      LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "150",
    });
    assert.deepEqual(config.dirs, ["src", "../../modules/trace"]);
    assert.equal(config.debounceMs, 150);
  });

  void it("watches unless LANGWATCH_DEV_WATCH turns it off", () => {
    assert.equal(resolveWatchConfig({}).enabled, true);
    for (const off of ["0", "false", "OFF"]) {
      assert.equal(resolveWatchConfig({ LANGWATCH_DEV_WATCH: off }).enabled, false);
    }
  });

  void it("falls back to the default debounce for a non-numeric override", () => {
    const config = resolveWatchConfig({ LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "not-a-number" });
    assert.equal(config.debounceMs, 2000);
  });
});

void describe("createDebouncer", () => {
  void it("given a burst of changes to one file, when the quiet window elapses, fires once", (t, done) => {
    const debouncer = createDebouncer({
      debounceMs: 30,
      onFire: (files) => {
        assert.deepEqual(files, ["src/api.entrypoint.ts"]);
        done();
      },
    });
    debouncer.note("src/api.entrypoint.ts");
    debouncer.note("src/api.entrypoint.ts");
    debouncer.note("src/api.entrypoint.ts");
  });

  /** @scenario "A burst of source changes restarts the API once" */
  void it("given a burst across five distinct files, when the quiet window elapses, fires once naming all five", (t, done) => {
    const debouncer = createDebouncer({
      debounceMs: 30,
      onFire: (files) => {
        assert.equal(files.length, 5);
        done();
      },
    });
    for (let i = 0; i < 5; i += 1) debouncer.note(`src/f${i}.ts`);
  });

  // The writer that matters is an agent, not a person: a rename across a
  // feature package lands hundreds of files, in bursts with gaps between them.
  // Every one of those has to collapse into ONE restart, or a single edit
  // session is dozens of cold starts and dozens of reconnects to Postgres,
  // ClickHouse and Redis.
  /** @scenario "A write storm from an agent restarts the backend once" */
  void it("given a write storm of hundreds of files spread across the window, when it settles, fires exactly once with all of them", (t, done) => {
    let fireCount = 0;
    const debouncer = createDebouncer({
      debounceMs: 60,
      onFire: (files) => {
        fireCount += 1;
        assert.equal(fireCount, 1);
        assert.equal(files.length, 400);
      },
    });
    // Four bursts of a hundred files, 20 ms apart — every gap shorter than the
    // window, so the window keeps restarting and nothing fires until the tree
    // is genuinely still.
    for (let burst = 0; burst < 4; burst += 1) {
      setTimeout(() => {
        for (let i = 0; i < 100; i += 1) debouncer.note(`modules/x/src/f${burst}-${i}.ts`);
      }, burst * 20);
    }
    setTimeout(() => {
      assert.equal(fireCount, 1);
      done();
    }, 300);
  });

  void it("given a new change inside the quiet window, when it lands, restarts the window instead of firing twice", (t, done) => {
    let fireCount = 0;
    const debouncer = createDebouncer({
      debounceMs: 40,
      onFire: (files) => {
        fireCount += 1;
        assert.equal(fireCount, 1);
        assert.deepEqual(files, ["a.ts", "b.ts"]);
      },
    });
    debouncer.note("a.ts");
    setTimeout(() => debouncer.note("b.ts"), 20);
    setTimeout(() => {
      assert.equal(fireCount, 1);
      done();
    }, 100);
  });

  void it("given a pending burst, when cancel runs, fires nothing", (t, done) => {
    const debouncer = createDebouncer({
      debounceMs: 20,
      onFire: () => assert.fail("must not fire after cancel"),
    });
    debouncer.note("a.ts");
    debouncer.cancel();
    setTimeout(() => done(), 50);
  });
});

void describe("resolveBundleConfig", () => {
  void it("is null when no bundle entry/out is configured", () => {
    assert.equal(resolveBundleConfig({}), null);
    assert.equal(resolveBundleConfig({ LANGWATCH_DEV_BUNDLE_ENTRY: "src/x.ts" }), null);
  });

  void it("reads the entry and outfile once both are set", () => {
    assert.deepEqual(
      resolveBundleConfig({
        LANGWATCH_DEV_BUNDLE_ENTRY: "src/worker.entrypoint.ts",
        LANGWATCH_DEV_BUNDLE_OUT: "dist-dev/worker.cjs",
      }),
      { entry: "src/worker.entrypoint.ts", outfile: "dist-dev/worker.cjs" },
    );
  });
});

void describe("stackControls", () => {
  /** @scenario "A restart lets the worker drain before it exits" */
  void it("given a process that drains quickly, when takeDown runs, waits for it rather than killing it", async () => {
    const child = spawnDrainingChild(150);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    await waitForOutput(child, /READY/);
    const stack = stackControls({ target: child.pid, graceMs: 5000 });
    const t0 = Date.now();
    const clean = await stack.takeDown();
    const elapsedMs = Date.now() - t0;

    assert.equal(clean, true);
    // It ran its own shutdown work (the setTimeout callback) before exiting —
    // a SIGKILL would have removed it before that callback ever fired.
    assert.match(output, /DRAINED/);
    // Comfortably under the 5s grace window: SIGTERM let it finish on its
    // own terms rather than the deadline forcing it.
    assert.ok(elapsedMs < 4000, `expected a fast drain, took ${elapsedMs}ms`);
  });

  void it("given a process that ignores SIGTERM, when the grace period elapses, kills it", async () => {
    const child = spawn(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); console.log("READY"); setInterval(() => {}, 1000);'],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    await waitForOutput(child, /READY/);
    const stack = stackControls({ target: child.pid, graceMs: 200 });
    const t0 = Date.now();
    const clean = await stack.takeDown();
    const elapsedMs = Date.now() - t0;

    assert.equal(clean, true);
    // Had to wait out the grace window before SIGKILL landed.
    assert.ok(elapsedMs >= 200, `expected at least the 200ms grace window, took ${elapsedMs}ms`);
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

void describe("files the backend never loads", () => {
  /** @scenario "Prose, specs and tool config leave the backend lane alone" */
  void it("ignores prose, feature files and tool config json", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/x/process/README.md"), true);
    assert.equal(shouldIgnoreWatchPath("../../modules/x/specs/a.feature"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/kernel/tsconfig.json"), true);
    assert.equal(shouldIgnoreWatchPath("../../modules/catalogue.json"), true);
  });

  void it("keeps package.json and json that lives in a src tree", () => {
    assert.equal(shouldIgnoreWatchPath("../../packages/kernel/package.json"), false);
    assert.equal(shouldIgnoreWatchPath("../../packages/kernel/src/table.json"), false);
  });
});

void describe("createBackendFilter", () => {
  function workspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-filter-"));
    const write = (dir, pkg) => {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, "package.json"), JSON.stringify(pkg));
    };
    write("apps/api", { name: "api", dependencies: { kernel: "workspace:*" } });
    write("packages/kernel", { name: "kernel", dependencies: { leaf: "workspace:*" } });
    write("packages/leaf", { name: "leaf" });
    write("packages/design-system", {
      name: "design-system",
      dependencies: { kernel: "workspace:*" },
    });
    return root;
  }

  /** @scenario "A browser-only package leaves the backend lane alone" */
  void it("ignores a package no backend dependency reaches, keeps the ones it does", () => {
    const root = workspace();
    const filter = createBackendFilter({
      cwd: path.join(root, "apps/api"),
      roots: [path.join(root, "packages")],
    });
    assert.equal(
      filter.isOutsideBackend(path.join(root, "packages/design-system/src/a.tsx")),
      true,
    );
    assert.equal(filter.isOutsideBackend(path.join(root, "packages/kernel/src/a.ts")), false);
    assert.equal(filter.isOutsideBackend(path.join(root, "packages/leaf/src/a.ts")), false);
    assert.equal(filter.isOutsideBackend(path.join(root, "packages/unknown/src/a.ts")), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  void it("filters nothing when the command has no package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-filter-"));
    const filter = createBackendFilter({ cwd: root, roots: [root] });
    assert.equal(filter.isOutsideBackend(path.join(root, "a.ts")), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/** @scenario "Changes during a reload queue exactly one follow-up" */
void describe("createReloadQueue", () => {
  void it("runs one reload at a time and answers a pile of requests with one follow-up", async () => {
    const runs = [];
    let active = 0;
    let maxActive = 0;
    const queue = createReloadQueue({
      run: async (files) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        runs.push(files);
        await sleep(40);
        active -= 1;
      },
    });
    const first = queue.request(["a.ts"]);
    await sleep(5);
    assert.equal(queue.isBusy(), true);
    void queue.request(["b.ts"]);
    void queue.request(["c.ts", "b.ts"]);
    await first;
    assert.deepEqual(runs, [["a.ts"], ["b.ts", "c.ts"]]);
    assert.equal(maxActive, 1);
    assert.equal(queue.isBusy(), false);
  });

  void it("does not run a follow-up when nothing arrived during the reload", async () => {
    let count = 0;
    const queue = createReloadQueue({ run: async () => void (count += 1) });
    await queue.request(["a.ts"]);
    assert.equal(count, 1);
  });
});

void describe("createDebouncer quiet window, max wait and hold", () => {
  /** @scenario "A steady trickle of edits still restarts within the max wait" */
  void it("fires at the max wait when writes never go quiet", async () => {
    const fired = [];
    const debouncer = createDebouncer({
      debounceMs: 60,
      maxWaitMs: 200,
      onFire: (files) => fired.push(files.length),
    });
    const start = Date.now();
    let n = 0;
    while (Date.now() - start < 300) {
      debouncer.note(`f${n++}.ts`);
      await sleep(20);
    }
    debouncer.cancel();
    assert.equal(fired.length, 1);
    assert.ok(fired[0] >= 8, `the max-wait fire carries the burst, got ${fired[0]}`);
  });

  /** @scenario "An agent mid-turn holds the restart until it is released" */
  void it("defers while the hold is active, then fires once it is released", async () => {
    let held = true;
    const fired = [];
    const debouncer = createDebouncer({
      debounceMs: 20,
      holdMs: () => (held ? 100 : 0),
      holdPollMs: 20,
      onFire: (files) => fired.push(files),
    });
    debouncer.note("a.ts");
    await sleep(150);
    assert.deepEqual(fired, []);
    held = false;
    await sleep(60);
    assert.deepEqual(fired, [["a.ts"]]);
  });

  void it("does not hold past the cap", async () => {
    const fired = [];
    const debouncer = createDebouncer({
      debounceMs: 10,
      holdMs: () => 10_000,
      holdCapMs: 80,
      holdPollMs: 20,
      onFire: (files) => fired.push(files),
    });
    debouncer.note("a.ts");
    await sleep(200);
    assert.deepEqual(fired, [["a.ts"]]);
  });
});

void describe("holdRemainingMs", () => {
  void it("reads the expiry the marker carries, capped, and 0 for absent or stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hold-"));
    const marker = path.join(dir, ".haven-hmr-gate");
    assert.equal(holdRemainingMs({ marker }), 0);
    fs.writeFileSync(marker, "5000\n");
    assert.equal(holdRemainingMs({ marker, now: 4000 }), 1000);
    assert.equal(holdRemainingMs({ marker, now: 6000 }), 0);
    fs.writeFileSync(marker, String(10 * 60_000));
    assert.equal(holdRemainingMs({ marker, now: 0 }), 60_000);
    fs.writeFileSync(marker, "garbage");
    assert.equal(holdRemainingMs({ marker }), 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
