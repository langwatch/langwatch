import { afterAll, describe, expect, it } from "vitest";
import { serviceLoadsItsOwnConfigRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { auth: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
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
        "modules/auth/server/src/services/auth0-password.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("configFunction");
      expect(found[0].data).toEqual({
        name: "loadConfig",
        path: "modules/auth/server/src/services/auth0-password.service.ts",
      });
    });
  });

  describe("when it declares a resolveConfig arrow function", () => {
    /** @scenario "A service's own resolveConfig arrow function is reported" */
    it("reports configFunction", () => {
      const found = report(
        "const resolveConfig = () => ({ domain: 1 });",
        "modules/auth/server/src/services/auth0-password.service.ts",
      );

      expect(found.map((e) => e.messageId)).toEqual(["configFunction"]);
    });
  });

  describe("when a readConfig class method is declared", () => {
    /** @scenario "A service's own readConfig method is reported" */
    it("reports configFunction", () => {
      const found = report(
        "class Auth0PasswordService { readConfig() { return {}; } }",
        "modules/auth/server/src/services/auth0-password.service.ts",
      );

      expect(found.map((e) => e.messageId)).toEqual(["configFunction"]);
    });
  });

  describe("when it reads process.env directly", () => {
    /** @scenario "A service reading process.env directly is reported" */
    it("reports environmentRead naming the key", () => {
      const found = report(
        "export const domain = process.env.AUTH0_DOMAIN;",
        "modules/auth/server/src/services/auth0-password.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("environmentRead");
      expect(found[0].message).toBe(
        "`modules/auth/server/src/services/auth0-password.service.ts`" +
          " reads `process.env.AUTH0_DOMAIN` directly instead of taking config as an argument." +
          " Add a named member to the argument object `create` takes and resolve it once at the composition root.",
      );
    });
  });

  describe("when it takes config as an argument instead", () => {
    /** @scenario "A service given its config as an argument is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "class Auth0PasswordService {" +
          " static create({ config }) { return new Auth0PasswordService(config); }" +
          " constructor(config) { this.config = config; } }",
        "modules/auth/server/src/services/auth0-password.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a transport file", () => {
  describe("when it reads process.env", () => {
    /** @scenario "A transport file reading process.env is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        "export const domain = process.env.AUTH0_DOMAIN;",
        "modules/auth/server/src/transport/auth.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
