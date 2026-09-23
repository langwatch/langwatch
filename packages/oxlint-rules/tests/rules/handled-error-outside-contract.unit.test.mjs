import { afterAll, describe, expect, it } from "vitest";

import { handledErrorOutsideContractRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(handledErrorOutsideContractRule, { code, cwd: workspace.cwd, filename });
}

describe("given a core module process package", () => {
  describe("when a class extends HandledError", () => {
    /** @scenario "A HandledError subclass declared in the process package is reported" */
    it("reports handledError and names the contract errors file", () => {
      const found = report(
        "class AgentBusyError extends HandledError {}",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("handledError");
      expect(found[0].message).toBe(
        "`AgentBusyError` is a `HandledError` subclass (it extends `HandledError`) declared in" +
          " `modules/agent/process/src/services/agent.service.ts`." +
          " Move it to `modules/agent/contract/src/agent.errors.ts`.",
      );
    });
  });

  describe("when a class extends a HandledError subclass imported from @langwatch/handled-error", () => {
    /** @scenario "A subclass of a handled-error base class is reported" */
    it("reports the class, on its own line, naming the base it extends", () => {
      const found = report(
        'import { NotFoundError as Missing } from "@langwatch/handled-error";\n' +
          "\n" +
          "export class AgentMissingError extends Missing {}",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(
        found.map((finding) => [finding.data.name, finding.data.parent, finding.line]),
      ).toEqual([["AgentMissingError", "Missing", 3]]);
    });
  });

  describe("when a class reaches HandledError through another class in the same file", () => {
    /** @scenario "A subclass reaching HandledError through a same-file class is reported" */
    it("reports every class in the chain", () => {
      const found = report(
        'import { HandledError } from "@langwatch/handled-error";\n' +
          "class AgentError extends HandledError {}\n" +
          "class AgentBusyError extends AgentError {}",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found.map((finding) => [finding.data.name, finding.line])).toEqual([
        ["AgentError", 2],
        ["AgentBusyError", 3],
      ]);
    });
  });

  describe("when the chain reaches only the built-in Error", () => {
    /** @scenario "A subclass of a plain error is not this rule's business" */
    it("reports nothing for a plain error chain", () => {
      const found = report(
        "class Base extends Error {}\nclass AgentBusyError extends Base {}",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a class extends something else", () => {
    /** @scenario "A subclass of a plain error is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "class AgentBusyError extends Error {}",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given an enterprise module process package", () => {
  describe("when a class extends HandledError", () => {
    /** @scenario "A HandledError subclass in an enterprise process package is reported" */
    it("names the enterprise contract errors file", () => {
      const found = report(
        "class SsoConfigError extends HandledError {}",
        "enterprise/modules/sso/process/src/services/sso.service.ts",
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
