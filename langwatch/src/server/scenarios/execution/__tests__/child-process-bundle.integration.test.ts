/**
 * @vitest-environment node
 *
 * Integration tests for the pre-compiled scenario child process bundle.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { execSync, spawnSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(__dirname, "../../../../..");
const BUNDLE_PATH = path.join(PACKAGE_ROOT, "dist", "scenario-child-process.js");

describe("Pre-compiled Scenario Child Process", () => {
  describe("when the child process build step runs", () => {
    beforeAll(() => {
      // Build the bundle fresh for testing
      execSync("pnpm run build:scenario-child-process", {
        cwd: PACKAGE_ROOT,
        stdio: "pipe",
      });
    }, 30000);

    afterAll(() => {
      // Clean up built artifacts
      if (fs.existsSync(BUNDLE_PATH)) {
        fs.unlinkSync(BUNDLE_PATH);
        const mapPath = `${BUNDLE_PATH}.map`;
        if (fs.existsSync(mapPath)) {
          fs.unlinkSync(mapPath);
        }
      }
    });

    it("produces a single JavaScript file at dist/scenario-child-process.js", () => {
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

    it("excludes shared singleton dependencies from the bundle", () => {
      const content = fs.readFileSync(BUNDLE_PATH, "utf8");

      // External deps should appear as require() calls, not inlined code
      expect(content).toContain('require("@opentelemetry/api")');
      expect(content).toContain('require("@langwatch/scenario")');
    });

    it("starts and reads from stdin within 5 seconds", async () => {
      const startTime = Date.now();

      const result = await new Promise<{ readyMs: number; exitCode: number | null }>(
        (resolve) => {
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

          let stderr = "";

          child.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

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
        },
      );

      // Process should have attempted to parse stdin (and failed on invalid JSON)
      // within 5 seconds, proving it started and read from stdin quickly
      expect(result.readyMs).toBeLessThan(5000);
      // Exit code 1 = it started, read stdin, failed to parse (expected behavior)
      expect(result.exitCode).toBe(1);
    }, 8000);
  });
});
