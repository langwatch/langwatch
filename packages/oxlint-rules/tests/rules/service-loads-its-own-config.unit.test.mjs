import { afterAll, describe, expect, it } from "vitest";

import { serviceLoadsItsOwnConfigRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { auth: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(serviceLoadsItsOwnConfigRule, { code, cwd: workspace.cwd, filename });
}

describe("given a service", () => {
  describe("when it declares a loadConfig function", () => {
    /** @scenario "A service's own loadConfig function is reported" */
    it("reports configFunction with the function name", () => {
      const found = report(
        "function loadConfig() { return {}; }",
        "modules/auth/process/src/services/auth0-password.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("configFunction");
      expect(found[0].data).toEqual({
        name: "loadConfig",
        path: "modules/auth/process/src/services/auth0-password.service.ts",
      });
    });
  });

  describe("when it declares a resolveConfig arrow function", () => {
    /** @scenario "A service's own resolveConfig arrow function is reported" */
    it("reports configFunction", () => {
      const found = report(
        "const resolveConfig = () => ({ domain: 1 });",
        "modules/auth/process/src/services/auth0-password.service.ts",
      );

      expect(found.map((e) => e.messageId)).toEqual(["configFunction"]);
    });
  });

  describe("when a readConfig class method is declared", () => {
    /** @scenario "A service's own readConfig method is reported" */
    it("reports configFunction", () => {
      const found = report(
        "class Auth0PasswordService { readConfig() { return {}; } }",
        "modules/auth/process/src/services/auth0-password.service.ts",
      );

      expect(found.map((e) => e.messageId)).toEqual(["configFunction"]);
    });
  });

  describe("when it reads process.env directly", () => {
    /** @scenario "A service reading process.env is environment-boundaries' business" */
    it("reports nothing", () => {
      const found = report(
        "export const domain = process.env.AUTH0_DOMAIN;",
        "modules/auth/process/src/services/auth0-password.service.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it takes config as an argument instead", () => {
    /** @scenario "A service given its config as an argument is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "class Auth0PasswordService {" +
          " static create({ config }) { return new Auth0PasswordService(config); }" +
          " constructor(config) { this.config = config; } }",
        "modules/auth/process/src/services/auth0-password.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a file outside services/", () => {
  describe("when it declares a loadConfig function", () => {
    /** @scenario "A file outside services is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "function loadConfig() { return {}; }",
        "modules/auth/process/src/adapters/auth0.adapter.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
