/**
 * @vitest-environment node
 * @see specs/scenarios/pre-compiled-child-process.feature
 * @see specs/scenarios/remote-trace-judging.feature
 */
import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { OPTIONAL_EXTERNALS } from "../../scripts/bundle-optional-externals.mjs";

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE_PATH = path.join(PACKAGE_ROOT, "dist", "server", "scenario-child-process.cjs");

describe("Pre-compiled Scenario Child Process", () => {
  describe("when the child process build step runs", () => {
    beforeAll(() => {
      execSync("pnpm run build:server", { cwd: PACKAGE_ROOT, stdio: "pipe" });
    }, 180_000);

    // No teardown on purpose. build:server wipes and rewrites the whole of
    // dist/server on every run, so nothing accumulates. Deleting the bundle
    // afterwards would leave the directory in the very state that sends a
    // production spawn down the tsx fallback.

    /** @scenario 'Build step produces a runnable JavaScript bundle' */
    it("produces a single JavaScript file at dist/server/scenario-child-process.cjs", () => {
      expect(fs.existsSync(BUNDLE_PATH)).toBe(true);

      const content = fs.readFileSync(BUNDLE_PATH, "utf8");
      expect(content.length).toBeGreaterThan(0);
    });

    /** @scenario 'An inlined dependency binds only exports the external OTEL packages still have' */
    it("evaluates its whole module graph against the installed OpenTelemetry", () => {
      // The SDK is inlined but @opentelemetry/* is not, so every OTEL binding
      // the inlined code reads resolves against whatever version this
      // application depends on. Disagree about an export and the child dies at
      // module scope on every run.

      // A missing EXPORT is invisible to a check for unresolved modules, and
      // the exit code is 1 whether the child crashed at module scope or read
      // its input and rejected it. Only the parse failure on stdout separates
      // the two.
      const boot = spawnSync("node", [BUNDLE_PATH], {
        cwd: path.dirname(BUNDLE_PATH),
        input: "{}",
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          SKIP_ENV_VALIDATION: "1",
          LANGWATCH_API_KEY: "test-key",
          LANGWATCH_ENDPOINT: "http://localhost:9999",
        },
        timeout: 60_000,
      });

      expect(boot.stdout?.toString() ?? "").toContain("Failed to parse job data");
    }, 70_000);

    /** @scenario 'A simulation still reports its spans' */
    it("keeps OpenTelemetry external so exactly one API instance exists", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");

      // The child flushes spans at exit through the globally registered
      // provider. A second, inlined copy of the API would take registration
      // and flush to different registries and silently drop every span, so
      // this must stay a require and no copy may be inlined alongside it.
      expect(content).toContain('require("@opentelemetry/api")');

      // `createNoopMeter` is defined only inside @opentelemetry/api's own
      // source, so its presence would mean a copy got inlined.
      expect(content).not.toContain("createNoopMeter");
    });

    /** @scenario 'Starting a simulation does not re-read its dependencies from disk' */
    it("inlines the scenario SDK instead of resolving it from node_modules", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");

      // Left external, requiring it walked the SDK's whole dependency graph
      // across the pnpm tree on every spawn — and the child is a fresh process
      // per scenario run, so that cost was paid every time.
      expect(content).not.toContain('require("@langwatch/scenario")');
    });

    /** @scenario 'The vendored SDK can act on the remote-trace configuration' */
    it("bundles an SDK that can act on the remote-trace run configuration", () => {
      // The platform's half of remote-trace judging is configuration only. The
      // SDK's run-config schema treats unknown keys as optional, so a vendored
      // SDK from before the capability accepts the same configuration and
      // silently ignores it: every http target's judge goes blind.

      // `wait_for_traces` is the judge's verdict-time extension tool and exists
      // only in SDK builds carrying the capability. It is a tool NAME, so it
      // survives bundling as a string literal — the cheapest proof the inlined
      // SDK can consume what the run configuration produces.
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");
      expect(content).toContain("wait_for_traces");
    });

    /** @scenario 'Configuring log output does not stop a simulation starting' */
    it.each([
      ["pretty console logs", { LOG_FORMAT: "pretty" }],
      ["the telemetry log transport", { PINO_OTEL_ENABLED: "true" }],
    ])(
      "starts with %s configured, without losing its transport worker",
      (_label, logEnv) => {
        // EXECUTES the path rather than asserting on the bundle text: the
        // logger finds its worker script next to its own package, so inlining
        // moves the lookup and the worker rethrows on nextTick — uncaught, past
        // the transport's try/catch, killing the child. Empty stdin makes the
        // child fail on job parsing AFTERWARDS, so a transport error is real.
        const boot = spawnSync("node", [BUNDLE_PATH], {
          cwd: path.dirname(BUNDLE_PATH),
          input: "",
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            SKIP_ENV_VALIDATION: "1",
            LANGWATCH_API_KEY: "test-key",
            LANGWATCH_ENDPOINT: "http://localhost:9999",
            ...logEnv,
          },
          timeout: 60_000,
        });

        // Pin the exit FIRST. Without it the absence checks below pass
        // vacuously whenever the child never launched at all — a failed spawn,
        // a timeout, a missing binary — all of which leave stderr empty.
        expect(boot.status).toBe(1);

        const stderr = boot.stderr?.toString() ?? "";
        expect(stderr).not.toContain("worker.js");
        expect(stderr).not.toContain("Cannot find module");
      },
      70_000,
    );

    /** @scenario 'Pre-compiled child process is ready for job data promptly' */
    it("starts and reads from stdin within 5 seconds", async () => {
      const startTime = Date.now();

      const result = await new Promise<{ readyMs: number; exitCode: number | null }>((resolve) => {
        const child = spawn("node", [BUNDLE_PATH], {
          env: {
            ...process.env,
            NODE_ENV: "test",
            LANGWATCH_API_KEY: "test-key",
            LANGWATCH_ENDPOINT: "http://localhost:9999",
            SKIP_ENV_VALIDATION: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
          cwd: PACKAGE_ROOT,
        });

        // Drain stderr so a full pipe buffer cannot stall the child.
        child.stderr?.resume();

        // Invalid JSON triggers a fast parse error, which proves stdin is read.
        child.stdin?.write("invalid-json");
        child.stdin?.end();

        const timeout = setTimeout(() => {
          child.kill();
          resolve({ readyMs: Date.now() - startTime, exitCode: null });
        }, 10_000);

        child.on("close", (code) => {
          clearTimeout(timeout);
          resolve({ readyMs: Date.now() - startTime, exitCode: code });
        });
      });

      expect(result.readyMs).toBeLessThan(5_000);
      // Exit 1 = it started, read stdin, and failed to parse.
      expect(result.exitCode).toBe(1);
    }, 15_000);

    // Whatever this entry does NOT inline is emitted as a runtime
    // `require("x")` that MUST resolve from the bundle's own directory — the
    // resolution root production uses. A package that is only a TRANSITIVE
    // dependency of a workspace package is not top-linked by pnpm, so its
    // require throws MODULE_NOT_FOUND at production boot.
    /** @scenario 'The child starts with every dependency it needs' */
    it("boots without MODULE_NOT_FOUND — every externalized require() resolves in a prod-shaped layout", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");
      const distDir = path.dirname(BUNDLE_PATH);

      // Externalized dependencies appear as bare `require("x")` in the bundle.
      const emitted = new Set<string>();
      for (const match of content.matchAll(/require\("([^".][^"]*)"\)/g)) {
        const name = match[1];
        if (name) emitted.add(name);
      }

      const externalPkgs = [...emitted].filter((name) => !name.startsWith(".") && !isBuiltin(name));

      // Sanity: if nothing is emitted the filters below pass vacuously, so pin
      // the packages that are external BY DESIGN. Both are in NEVER_INLINED —
      // the logger because it loads its worker script by directory,
      // OpenTelemetry to keep one API instance in the child — so neither can
      // quietly stop being emitted while this entry inlines the rest.
      expect(externalPkgs).toContain("pino");
      expect(externalPkgs).toContain("@opentelemetry/api");

      // PRIMARY — EXECUTE the affected path. Node resolves the bundle's
      // externals relative to the bundle file, the exact production root, so
      // spawning it here reproduces the crash if any external is unresolvable.
      // Empty stdin makes it fail fast on job parsing AFTER module load, so any
      // module error is a real regression.
      const boot = spawnSync("node", [BUNDLE_PATH], {
        cwd: distDir,
        input: "",
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "test",
          SKIP_ENV_VALIDATION: "1",
          LANGWATCH_API_KEY: "test-key",
          LANGWATCH_ENDPOINT: "http://localhost:9999",
        },
        timeout: 60_000,
      });
      const bootStderr = boot.stderr?.toString() ?? "";
      expect(bootStderr).not.toContain("MODULE_NOT_FOUND");
      expect(bootStderr).not.toContain("Cannot find module");

      // SUPPLEMENTARY — resolve each external from the production-shaped root
      // so a failure NAMES the exact unresolved module; the runtime check above
      // only reports that something failed. Optional peers are required behind
      // a runtime guard, so being unresolvable is their designed state. Same
      // list the build's dependency check uses, so the two cannot drift.
      const optional = new Set<string>(OPTIONAL_EXTERNALS);
      const unresolved = externalPkgs.filter((name) => {
        if (optional.has(name)) return false;
        try {
          require.resolve(name, { paths: [distDir] });
          return false;
        } catch {
          return true;
        }
      });

      expect(unresolved).toEqual([]);
    }, 70_000);
  });
});
