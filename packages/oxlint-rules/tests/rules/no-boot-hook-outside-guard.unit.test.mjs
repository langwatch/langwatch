import { afterAll, describe, expect, it } from "vitest";

import { noBootHookOutsideGuardRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noBootHookOutsideGuardRule, { code, cwd: workspace.cwd, filename });
}

describe("given a file outside the boot guard", () => {
  describe("when it registers an uncaughtException handler", () => {
    /** @scenario "A second uncaughtException handler races the boot guard" */
    it("reports bootHookOutsideGuard", () => {
      const found = report(
        "process.on('uncaughtException', () => {});",
        "apps/api/src/app/api-production.composition.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bootHookOutsideGuard");
      expect(found[0].data.event).toBe("uncaughtException");
    });
  });

  describe("when it registers an unhandledRejection handler", () => {
    /** @scenario "A second unhandledRejection handler races the boot guard" */
    it("reports bootHookOutsideGuard", () => {
      const found = report(
        "process.on('unhandledRejection', () => {});",
        "apps/worker/src/app/worker-production.composition.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("bootHookOutsideGuard");
    });
  });

  describe("when it registers the handler through once or addListener", () => {
    /** @scenario "A once or addListener handler races the boot guard too" */
    it("reports bootHookOutsideGuard naming the method, on each line", () => {
      const found = report(
        "process.once('uncaughtException', () => {});\nprocess.addListener('unhandledRejection', () => {});",
        "services/langyworker/src/main.ts",
      );

      expect(found.map((entry) => [entry.data.method, entry.data.event, entry.line])).toEqual([
        ["once", "uncaughtException", 1],
        ["addListener", "unhandledRejection", 2],
      ]);
    });
  });

  describe("when it registers an unrelated process event", () => {
    /** @scenario "A non boot-failure process event is allowed" */
    it("reports nothing", () => {
      expect(
        report("process.on('exit', () => {});", "apps/api/src/app/api-production.composition.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file is one of the two boot guards", () => {
    /** @scenario "The boot guards own process-level failure handling" */
    it("reports nothing", () => {
      const code = "process.on('uncaughtException', () => {});";

      expect(report(code, "packages/process-server/src/server.ts")).toEqual([]);
      expect(report(code, "packages/observability/src/boot-guard.ts")).toEqual([]);
    });
  });

  describe("when the file belongs to a published SDK", () => {
    /** @scenario "A published SDK owns its own process handling" */
    it("reports nothing", () => {
      const code = "process.once('uncaughtException', () => {});";

      expect(report(code, "sdks/typescript/src/cli/commands/agents/tunnel.ts")).toEqual([]);
    });
  });
});
