// Unit tests for the `--watch` debounce/ignore logic and the SIGTERM-wait-
// SIGKILL drain primitive added to dev-supervisor.mjs
// (specs/setup/dev-process-topology.feature: "A burst of source changes
// restarts the API once", "A restart lets the worker drain before it
// exits"). Exercises the module's exported functions directly — no stack
// boot; the one place this spawns a process at all is a tiny throwaway
// fixture script standing in for "a process that drains on SIGTERM", not
// the api/worker application.
//
//   node --test dev/scripts/__tests__/dev-supervisor-watch.unit.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import {
  createDebouncer,
  resolveBundleConfig,
  resolveWatchConfig,
  shouldIgnoreWatchPath,
  stackControls,
} from "../dev-supervisor.mjs";

/**
 * A standalone child (its own process group) that prints READY once its
 * SIGTERM handler is installed, then, on SIGTERM, waits `drainMs` — standing
 * in for "finishing an in-flight job" — before printing DRAINED and exiting
 * 0. Never installs a SIGKILL-proof handler: the point is to observe whether
 * `stackControls` gives it the time to finish on its own. The READY
 * handshake (rather than a fixed delay) is what makes the test not race a
 * fresh `node -e` process's own startup time.
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

describe("shouldIgnoreWatchPath", () => {
  it("ignores a __tests__ directory", () => {
    assert.equal(shouldIgnoreWatchPath("src/__tests__/foo.unit.test.ts"), true);
  });

  it("ignores a *.test.ts file outside __tests__", () => {
    assert.equal(
      shouldIgnoreWatchPath("../../modules/trace/server/src/foo.test.ts"),
      true,
    );
  });

  it("ignores a *.spec.tsx file", () => {
    assert.equal(shouldIgnoreWatchPath("src/foo.spec.tsx"), true);
  });

  it("ignores an editor temp file written beside its target", () => {
    assert.equal(
      shouldIgnoreWatchPath("../../modules/trace/web/src/a.tsx.tmp.17938.dfd323429215"),
      true,
    );
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/web/src/a.tsx"), false);
  });

  it("ignores a test suite's scratch directory beside the package", () => {
    assert.equal(shouldIgnoreWatchPath("../../packages/api/.tmp-rest-handler-tQBUui/fixture.ts"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/api/.tmp-rest-handler-tQBUui"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/api/src/rest/pipeline.ts"), false);
  });

  it("ignores dist and generated churn", () => {
    assert.equal(shouldIgnoreWatchPath("../../modules/trace/server/dist/index.js"), true);
    assert.equal(shouldIgnoreWatchPath("src/generated/types.ts"), true);
  });

  it("ignores tsbuildinfo and node_modules churn", () => {
    assert.equal(shouldIgnoreWatchPath("src/.tsbuildinfo"), true);
    assert.equal(shouldIgnoreWatchPath("../../packages/foo/node_modules/bar/index.js"), true);
  });

  it("does not ignore an ordinary source file", () => {
    assert.equal(shouldIgnoreWatchPath("src/api.entrypoint.ts"), false);
    assert.equal(
      shouldIgnoreWatchPath("../../modules/trace/server/src/trace.service.ts"),
      false,
    );
  });
});

describe("resolveWatchConfig", () => {
  it("defaults to src and ../../packages with a 750ms window", () => {
    const config = resolveWatchConfig({});
    assert.deepEqual(config.dirs, ["src", "../../packages"]);
    assert.equal(config.debounceMs, 750);
  });

  it("reads an override for both the dirs and the debounce window", () => {
    const config = resolveWatchConfig({
      LANGWATCH_DEV_WATCH_DIRS: "src, ../../modules/trace ",
      LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "150",
    });
    assert.deepEqual(config.dirs, ["src", "../../modules/trace"]);
    assert.equal(config.debounceMs, 150);
  });

  it("falls back to the default debounce for a non-numeric override", () => {
    const config = resolveWatchConfig({ LANGWATCH_DEV_WATCH_DEBOUNCE_MS: "not-a-number" });
    assert.equal(config.debounceMs, 750);
  });
});

describe("createDebouncer", () => {
  it("given a burst of changes to one file, when the quiet window elapses, fires once", (t, done) => {
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
  it("given a burst across five distinct files, when the quiet window elapses, fires once naming all five", (t, done) => {
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
  it("given a write storm of hundreds of files spread across the window, when it settles, fires exactly once with all of them", (t, done) => {
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

  it("given a new change inside the quiet window, when it lands, restarts the window instead of firing twice", (t, done) => {
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

  it("given a pending burst, when cancel runs, fires nothing", (t, done) => {
    const debouncer = createDebouncer({
      debounceMs: 20,
      onFire: () => assert.fail("must not fire after cancel"),
    });
    debouncer.note("a.ts");
    debouncer.cancel();
    setTimeout(done, 50);
  });
});

describe("resolveBundleConfig", () => {
  it("is null when no bundle entry/out is configured", () => {
    assert.equal(resolveBundleConfig({}), null);
    assert.equal(resolveBundleConfig({ LANGWATCH_DEV_BUNDLE_ENTRY: "src/x.ts" }), null);
  });

  it("reads the entry and outfile once both are set", () => {
    assert.deepEqual(
      resolveBundleConfig({
        LANGWATCH_DEV_BUNDLE_ENTRY: "src/worker.entrypoint.ts",
        LANGWATCH_DEV_BUNDLE_OUT: "dist-dev/worker.cjs",
      }),
      { entry: "src/worker.entrypoint.ts", outfile: "dist-dev/worker.cjs" },
    );
  });
});

describe("stackControls", () => {
  /** @scenario "A restart lets the worker drain before it exits" */
  it("given a process that drains quickly, when takeDown runs, waits for it rather than killing it", async () => {
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

  it("given a process that ignores SIGTERM, when the grace period elapses, kills it", async () => {
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
