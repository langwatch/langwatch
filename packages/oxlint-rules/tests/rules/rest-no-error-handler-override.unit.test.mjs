import { afterAll, describe, expect, it } from "vitest";
import { restNoErrorHandlerOverrideRule } from "../../src/rules/rest-no-error-handler-override.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/transport/agent.rest.ts") {
  return runRule(restNoErrorHandlerOverrideRule, { code, cwd: workspace.cwd, filename });
}

describe("given a REST transport file", () => {
  describe("when it imports the RestErrorHandler type", () => {
    /** @scenario "A type-only import of RestErrorHandler is reported" */
    it("reports override", () => {
      const found = report('import { type RestErrorHandler } from "@langwatch/api/rest";');

      expect(found.map((entry) => entry.messageId)).toEqual(["override"]);
    });
  });

  describe("when it imports RestErrorHandler as a value alongside other imports", () => {
    /** @scenario "A value import of RestErrorHandler alongside others is reported once" */
    it("reports override once", () => {
      const found = report(
        'import { defineRestRouter, RestErrorHandler, createFamilyErrorHandler } from "@langwatch/api/rest";',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["override"]);
    });
  });

  describe("when it renames RestErrorHandler on import", () => {
    /** @scenario "A renamed import of RestErrorHandler is still reported" */
    it("reports override", () => {
      const found = report('import { RestErrorHandler as Boundary } from "@langwatch/api/rest";');

      expect(found.map((entry) => entry.messageId)).toEqual(["override"]);
    });
  });

  describe("when it imports only unrelated names", () => {
    /** @scenario "Importing unrelated names from the rest package is not this rule's business" */
    it("reports nothing", () => {
      const found = report('import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";');

      expect(found).toEqual([]);
    });
  });
});

describe("given a server file outside the server role", () => {
  describe("when a contract file imports something named RestErrorHandler", () => {
    /** @scenario "RestErrorHandler outside a server package is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { type RestErrorHandler } from "@langwatch/api/rest";',
        "modules/agent/contract/src/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
