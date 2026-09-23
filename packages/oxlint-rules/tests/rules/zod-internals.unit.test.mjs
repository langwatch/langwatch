import { afterAll, describe, expect, it } from "vitest";

import { zodInternalsRule } from "../../src/rules/zod-internals.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(zodInternalsRule, { code, cwd: workspace.cwd, filename });
}

describe("given a governed contract source file", () => {
  describe("when it reads ._def off a *schema-named identifier", () => {
    /** @scenario "reading a schema's def is reported" */
    it("reports defAccess", () => {
      const found = report(
        "export const shape = mySchema._def;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("defAccess");
      expect(found[0].data.object).toBe("mySchema");
    });
  });

  describe("when it reads ._def off a z. call chain", () => {
    /** @scenario "reading a schema's def is reported" */
    it("reports defAccess", () => {
      const found = report(
        "export const shape = z.object({}).shape;\nexport const raw = z.object({})._def;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("defAccess");
      expect(found[0].data.object).toBe("z.object({})");
    });
  });

  describe("when it reads ._def off a local not named *schema", () => {
    /** @scenario "an aliased schema's def is reported too" */
    it("reports defAccess", () => {
      const found = report(
        "const s = schema; export const inner = s._def.innerType;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("defAccess");
      expect(found[0].data.object).toBe("s");
    });
  });

  describe("when it tests an error with instanceof ZodError", () => {
    /** @scenario "an instanceof ZodError check is reported" */
    it("reports zodErrorInstanceOf", () => {
      const found = report(
        "export const isZod = (error) => error instanceof ZodError;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("zodErrorInstanceOf");
      expect(found[0].data.right).toBe("ZodError");
    });
  });

  describe("when it tests an error with instanceof z.ZodError", () => {
    /** @scenario "an instanceof ZodError check is reported" */
    it("reports zodErrorInstanceOf", () => {
      const found = report(
        "export const isZod = (error) => error instanceof z.ZodError;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("zodErrorInstanceOf");
      expect(found[0].data.right).toBe("z.ZodError");
    });
  });

  describe("when the file is a test", () => {
    it("reports nothing", () => {
      expect(
        report(
          "export const shape = mySchema._def;",
          "modules/agent/contract/src/__tests__/agent.schema.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given the tRPC host file", () => {
  describe("when it reads a router's def to classify a procedure", () => {
    /** @scenario "the tRPC host's def reads are left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "const procedures = router._def.procedures;\nconst type = procedures[path]?._def?.type;",
          "apps/api/src/app-trpc/api-trpc.host.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the same router shape is read outside that file", () => {
    /** @scenario "an aliased schema's def is reported too" */
    it("reports defAccess", () => {
      const found = report(
        "export const procedures = router._def.procedures;",
        "modules/agent/contract/src/agent.schema.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("defAccess");
      expect(found[0].data.object).toBe("router");
    });
  });
});
