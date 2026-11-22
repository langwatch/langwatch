import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { resolveLocalOrchestratorConfig } from "../src/platform/config/local-orchestrator.config.ts";

// A predep that never installs, so the failure prompt is reached.
const failing = vi.hoisted(() => ({
  id: "postgres",
  label: "postgres",
  required: true,
  detect: async () => ({ installed: false, reason: "missing" }),
  install: async () => {
    throw new Error("network unavailable");
  },
}));
vi.mock("../src/predeps/registry.ts", () => ({ predepRegistry: () => [failing] }));
vi.mock("../src/shared/platform.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  detectPlatform: () => "darwin-arm64",
}));

const home = mkdtempSync(join(tmpdir(), "langwatch-runner-abort-"));
vi.stubEnv("LANGWATCH_HOME", home);
const { runPredeps } = await import("../src/predeps/runner.ts");

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("the predeps phase", () => {
  describe("when an install fails in CI", () => {
    /** @scenario "Aborting the install stops the services already started" */
    it("returns the abort to the caller instead of exiting, so started services can be stopped", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("the runner exited the process");
      });
      const config = resolveLocalOrchestratorConfig({ CI: "true" });

      const run = await runPredeps({ config, yes: true, version: "3.21.0" });

      expect(run).toEqual({
        outcome: "aborted",
        exitCode: 1,
        reason: "postgres did not install",
      });
      expect(exit).not.toHaveBeenCalled();
    });
  });
});
