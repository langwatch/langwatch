import { afterAll, describe, expect, it } from "vitest";
import { handledErrorOutsideContractRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(handledErrorOutsideContractRule, { code, cwd: workspace.cwd, filename });
}

describe("given a core module server package", () => {
  describe("when a class extends HandledError", () => {
    /** @scenario "A HandledError subclass declared in the server package is reported" */
    it("reports handledError and names the contract errors file", () => {
      const found = report(
        "class AgentBusyError extends HandledError {}",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("handledError");
      expect(found[0].message).toBe(
        "`AgentBusyError` extends `HandledError` in" +
          " `modules/agent/server/src/services/agent.service.ts`." +
          " Move it to `modules/agent/contract/src/agent.errors.ts`.",
      );
    });
  });

  describe("when a class extends something else", () => {
    /** @scenario "A subclass of a plain error is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "class AgentBusyError extends Error {}",
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given an enterprise module server package", () => {
  describe("when a class extends HandledError", () => {
    /** @scenario "A HandledError subclass in an enterprise server package is reported" */
    it("names the enterprise contract errors file", () => {
      const found = report(
        "class SsoConfigError extends HandledError {}",
        "enterprise/modules/sso/server/src/services/sso.service.ts",
      );

      expect(found[0].message).toContain("enterprise/modules/sso/contract/src/sso.errors.ts");
    });
  });
});

describe("given the module's contract package", () => {
  describe("when a class extends HandledError", () => {
    /** @scenario "A HandledError subclass declared in its contract package is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "export class AgentBusyError extends HandledError {}",
        "modules/agent/contract/src/agent.errors.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
