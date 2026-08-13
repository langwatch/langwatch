/**
 * @vitest-environment node
 *
 * Integration tests for the pre-compiled scenario child process bundle.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { execSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import { isBuiltin } from "module";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { OPTIONAL_EXTERNALS } from "../../../../../scripts/bundle-optional-externals.mjs";

const PACKAGE_ROOT = path.resolve(__dirname, "../../../../..");
const BUNDLE_PATH = path.join(
  PACKAGE_ROOT,
  "dist",
  "server",
  "scenario-child-process.cjs",
);

describe("Pre-compiled Scenario Child Process", () => {
  describe("when the child process build step runs", () => {
    beforeAll(() => {
      // Build the bundle fresh for testing (build:server emits all server
      // bundles, the scenario child process among them)
      execSync("pnpm run build:server", {
        cwd: PACKAGE_ROOT,
        stdio: "pipe",
      });
    }, 60000);

    // No teardown on purpose. build:server wipes and rewrites the whole of
    // dist/server on every run, so nothing accumulates. Deleting just this one
    // bundle afterwards left the directory PARTIAL — the other three entry
    // points rebuilt, the scenario bundle gone — which is the state that sends
    // production scenario spawns down the tsx fallback.

    /** @scenario 'Build step produces a runnable JavaScript bundle' */
    it("produces a single JavaScript file at dist/server/scenario-child-process.cjs", () => {
      expect(fs.existsSync(BUNDLE_PATH)).toBe(true);

      const content = fs.readFileSync(BUNDLE_PATH, "utf8");
      expect(content.length).toBeGreaterThan(0);
    });

    it("resolves all require() calls without module errors", () => {
      // The bundle executes main() on require, which reads stdin and exits 1
      // when no input is provided. That's expected. What we're checking is that
      // no MODULE_NOT_FOUND errors occur — meaning all externals resolve.
      const result = spawnSync("node", ["-e", `require('${BUNDLE_PATH}')`], {
        cwd: PACKAGE_ROOT,
        stdio: "pipe",
        env: {
          ...process.env,
          SKIP_ENV_VALIDATION: "1",
          LANGWATCH_API_KEY: "test-key",
          LANGWATCH_ENDPOINT: "http://localhost:9999",
        },
        timeout: 10000,
      });

      const stderr = result.stderr?.toString() ?? "";
      expect(stderr).not.toContain("MODULE_NOT_FOUND");
      expect(stderr).not.toContain("Cannot find module");
    });

    /** @scenario 'OpenTelemetry stays external so the child holds one tracer provider' */
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

    /** @scenario 'The scenario SDK is inlined rather than required at runtime' */
    it("inlines the scenario SDK instead of resolving it from node_modules", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");

      // Left external, requiring it walked the SDK's whole dependency graph
      // across the pnpm tree on every spawn — and the child is a fresh process
      // per scenario run, so that cost was paid every time.
      expect(content).not.toContain('require("@langwatch/scenario")');
    });

    /** @scenario 'Pre-compiled child process is ready for job data promptly' */
    it("starts and reads from stdin within 5 seconds", async () => {
      const startTime = Date.now();

      const result = await new Promise<{
        readyMs: number;
        exitCode: number | null;
      }>((resolve) => {
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

        // Send invalid JSON to trigger a fast parse error — proves stdin is being read
        child.stdin?.write("invalid-json");
        child.stdin?.end();

        const timeout = setTimeout(() => {
          child.kill();
          resolve({ readyMs: Date.now() - startTime, exitCode: null });
        }, 10000);

        child.on("close", (code) => {
          clearTimeout(timeout);
          resolve({ readyMs: Date.now() - startTime, exitCode: code });
        });
      });

      // Process should have attempted to parse stdin (and failed on invalid JSON)
      // within 5 seconds, proving it started and read from stdin quickly
      expect(result.readyMs).toBeLessThan(5000);
      // Exit code 1 = it started, read stdin, failed to parse (expected behavior)
      expect(result.exitCode).toBe(1);
    }, 8000);

    // Regression guard for #5855. Whatever this entry does NOT inline is
    // emitted as a runtime require("x") that MUST resolve from the bundle's
    // own directory — the exact resolution root prod uses. A package that is
    // only a transitive dep of a workspace package (e.g. pino via
    // @langwatch/observability) is NOT top-linked into platform/app/node_modules by
    // pnpm, so its require throws MODULE_NOT_FOUND at prod boot. #2404 caused
    // exactly this by moving the pino family out of the app manifest.
    //
    // This entry now inlines its graph, which shrinks the exposure to the
    // OpenTelemetry packages held out on purpose — but it does not remove it,
    // and the check stays as the thing that proves it.
    /** @scenario 'Every externalized require resolves from the bundle directory' */
    it("boots without MODULE_NOT_FOUND — every externalized require() resolves in a prod-shaped layout", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");
      const distDir = path.dirname(BUNDLE_PATH);

      // Externalized deps appear as bare `require("x")` in the CJS bundle.
      const emitted = new Set<string>();
      const re = /require\("([^".][^"]*)"\)/g;
      for (const match of content.matchAll(re)) {
        const name = match[1];
        if (name) {
          emitted.add(name);
        }
      }

      const externalPkgs = [...emitted].filter(
        (name) => !name.startsWith(".") && !isBuiltin(name),
      );

      // Sanity: if nothing is emitted the filters below pass vacuously, so pin
      // a package that is external BY DESIGN. This entry inlines its graph, so
      // OpenTelemetry — held out deliberately to keep one API instance in the
      // child — is the dependable sentinel. (pino filled this role while the
      // entry externalized everything; it is inlined now.)
      expect(externalPkgs).toContain("@opentelemetry/api");

      // PRIMARY — EXECUTE the affected code path (coding guideline: runtime
      // regression tests must run the code and observe the crash, not just assert
      // strings). #5855 was a top-level require("pino") throwing MODULE_NOT_FOUND
      // at boot. Node resolves the bundle's externals relative to the bundle file
      // (dist/) — the exact prod root — so spawning it here reproduces the crash
      // if any external is unresolvable. Empty stdin makes it fail fast on job
      // parsing AFTER module load, so any module error is a real regression.
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
        timeout: 15000,
      });
      const bootStderr = boot.stderr?.toString() ?? "";
      expect(bootStderr).not.toContain("MODULE_NOT_FOUND");
      expect(bootStderr).not.toContain("Cannot find module");

      // SUPPLEMENTARY — resolve each external from the prod-shaped root so a
      // failure NAMES the exact unresolved module (the runtime check above only
      // reports that *something* failed). Execute-the-path + precise attribution.
      // Optional peers are require'd behind a runtime guard, so being
      // unresolvable is their designed state, not a regression. Same list the
      // build's dependency check uses, so the two cannot drift apart.
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
    });
  });
});
