import { afterAll, describe, expect, it } from "vitest";
import { secretsThroughSourceRule } from "../../src/rules/secrets-through-source.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(secretsThroughSourceRule, { code, cwd: workspace.cwd, filename });
}

describe("given production source", () => {
  describe("when it reads a classified secret from process.env", () => {
    /** @scenario "Reading a classified secret from the environment is reported" */
    it("names the key and says to resolve it through the source chain", () => {
      const found = report(
        "export const key = process.env.OPENAI_API_KEY;",
        "packages/features/agent/server/src/services/agent.service.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("secret");
      expect(found[0].message).toBe(
        "`OPENAI_API_KEY` is a classified secret and is read straight from the environment here." +
          " Resolve it through the SecretSource chain at the boot seam and pass the typed value in.",
      );
    });
  });

  describe("when it reads the secret through a bracketed literal", () => {
    /** @scenario "A bracketed secret read is reported" */
    it("reports it too", () => {
      expect(
        report(
          'export const key = process.env["LW_GATEWAY_JWT_SECRET"];',
          "apps/tasks/src/platform/object-storage.ts",
        ),
      ).toHaveLength(1);
    });
  });

  describe("when it reads an unclassified configuration value", () => {
    /** @scenario "A configuration read is not this rule's business" */
    it("reports nothing", () => {
      expect(
        report(
          "export const host = process.env.BASE_HOST;",
          "packages/features/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given the boot seam", () => {
  describe("when it reads a classified secret", () => {
    /** @scenario "The boot seam may read a classified secret" */
    it("reports nothing", () => {
      expect(
        report(
          "export const key = process.env.OPENAI_API_KEY;",
          "apps/api/src/platform/config/api.config.ts",
        ),
      ).toEqual([]);
      expect(
        report("export const key = process.env.OPENAI_API_KEY;", "apps/api/src/api.main.ts"),
      ).toEqual([]);
    });
  });
});

describe("given the secrets package itself", () => {
  describe("when it reads a classified secret", () => {
    /** @scenario "The secrets package may read a classified secret" */
    it("reports nothing", () => {
      expect(
        report(
          "export const key = process.env.OPENAI_API_KEY;",
          "packages/secrets/src/env.secret-source.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a test file", () => {
  describe("when it reads a classified secret", () => {
    /** @scenario "A test file may read a classified secret" */
    it("reports nothing", () => {
      expect(
        report(
          "export const key = process.env.OPENAI_API_KEY;",
          "packages/features/agent/server/src/services/agent.service.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });
});
