import { afterAll, describe, expect, it } from "vitest";
import { noBootHookOutsideGuardRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
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

  describe("when it registers an unrelated process event", () => {
    /** @scenario "A non boot-failure process event is allowed" */
    it("reports nothing", () => {
      expect(
        report("process.on('exit', () => {});", "apps/api/src/app/api-production.composition.ts"),
      ).toEqual([]);
    });
  });

  describe("when the file is the boot guard itself", () => {
    /** @scenario "The boot guard owns process-level failure handling" */
    it("reports nothing", () => {
      expect(
        report(
          "process.on('uncaughtException', () => {});",
          "packages/observability/src/boot-guard.ts",
        ),
      ).toEqual([]);
    });
  });
});
