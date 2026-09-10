import { afterAll, describe, expect, it } from "vitest";
import { noRawErrorOutputRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(noRawErrorOutputRule, { code, cwd: workspace.cwd, filename });
}

describe("given governed server code", () => {
  describe("when it calls console.error with a caught error identifier", () => {
    /** @scenario "console.error on a caught error is a raw dump" */
    it("reports rawErrorOutput", () => {
      const found = report(
        "try {} catch (err) { console.error(err); }",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("rawErrorOutput");
      expect(found[0].data.call).toBe("console.error");
    });
  });

  describe("when it calls console.log with an error's stack", () => {
    /** @scenario "console.log of error.stack is a raw dump" */
    it("reports rawErrorOutput", () => {
      const found = report(
        "try {} catch (error) { console.log(error.stack); }",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("rawErrorOutput");
    });
  });

  describe("when it writes an error's stack to process.stderr", () => {
    /** @scenario "process.stderr.write of err.stack is a raw dump" */
    it("reports rawErrorOutput", () => {
      const found = report(
        "try {} catch (e) { process.stderr.write(e.stack); }",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("rawErrorOutput");
      expect(found[0].data.call).toBe("process.stderr.write");
    });
  });

  describe("when console logs a non-error identifier", () => {
    /** @scenario "console.log of an unrelated value is allowed" */
    it("reports nothing", () => {
      expect(
        report(
          "console.log(result);",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    /** @scenario "A raw error dump in a test file is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "try {} catch (err) { console.error(err); }",
          "modules/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is the boot guard", () => {
    /** @scenario "The boot guard may dump the error it caught" */
    it("reports nothing", () => {
      expect(
        report(
          "try {} catch (err) { console.error(err); }",
          "packages/observability/src/boot-guard.ts",
        ),
      ).toEqual([]);
    });
  });
});
