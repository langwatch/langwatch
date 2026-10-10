import { afterAll, describe, expect, it } from "vitest";

import { contractSchemaNamedRule } from "../../src/index.mjs";
import { createFixtureWorkspace, expectFix, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const contractFile = "modules/agent/contract/src/agent.ts";

function report(code, filename = contractFile) {
  return runRule(contractSchemaNamedRule, { code, cwd: workspace.cwd, filename });
}

function fix(code, output, { errors = 1 } = {}) {
  expectFix(contractSchemaNamedRule, {
    code,
    cwd: workspace.cwd,
    errors,
    filename: contractFile,
    output,
  });
}

describe("given a contract source file", () => {
  describe("when it exports an unnamed object schema", () => {
    /** @scenario "An exported object schema without a name is a failure" */
    it("reports unnamedSchema", () => {
      const found = report(
        'import { z } from "zod";\nexport const agentSchema = z.object({ id: z.string() });',
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("unnamedSchema");
      expect(found[0].data.name).toBe("agentSchema");
    });

    /** @scenario "The fix names the schema and imports Named" */
    it("names the schema and imports Named", () => {
      expect(() =>
        fix(
          'import { z } from "zod";\nexport const agentSchema = z.object({ id: z.string() });',
          [
            'import { z } from "zod";',
            'import type { Named } from "@langwatch/module";',
            "const agentSchemaDefinition = z.object({ id: z.string() });",
            "export interface AgentSchema extends Named<typeof agentSchemaDefinition> {}",
            "export const agentSchema: AgentSchema = agentSchemaDefinition;",
          ].join("\n"),
        ),
      ).not.toThrow();
    });

    it("adds Named to an existing @langwatch/module import", () => {
      expect(() =>
        fix(
          'import { defineTrpcContract } from "@langwatch/module";\nexport const aSchema = z.union([z.string(), z.number()]);',
          [
            'import { defineTrpcContract, type Named } from "@langwatch/module";',
            "const aSchemaDefinition = z.union([z.string(), z.number()]);",
            "export interface ASchema extends Named<typeof aSchemaDefinition> {}",
            "export const aSchema: ASchema = aSchemaDefinition;",
          ].join("\n"),
        ),
      ).not.toThrow();
    });

    it("imports Named once for two schemas", () => {
      expect(() =>
        fix(
          'import { z } from "zod";\nexport const aSchema = z.object({});\nexport const bSchema = aSchema.extend({});',
          [
            'import { z } from "zod";',
            'import type { Named } from "@langwatch/module";',
            "const aSchemaDefinition = z.object({});",
            "export interface ASchema extends Named<typeof aSchemaDefinition> {}",
            "export const aSchema: ASchema = aSchemaDefinition;",
            "const bSchemaDefinition = aSchema.extend({});",
            "export interface BSchema extends Named<typeof bSchemaDefinition> {}",
            "export const bSchema: BSchema = bSchemaDefinition;",
          ].join("\n"),
          { errors: 2 },
        ),
      ).not.toThrow();
    });
  });

  describe("when the schema is already named, primitive or recursive", () => {
    /** @scenario "Named, primitive and recursive schemas pass" */
    it("reports nothing", () => {
      const code = [
        'import { z } from "zod";',
        "export const aSchema: ASchema = aSchemaDefinition;",
        "export const idSchema = z.string().min(1);",
        "export const kindSchema = z.enum(['a', 'b']);",
        "export const nodeSchema = z.object({ get children() { return z.array(nodeSchema); } });",
        "export const treeSchema = z.lazy(() => z.object({}));",
        "const localSchema = z.object({});",
      ].join("\n");

      expect(report(code)).toHaveLength(0);
    });
  });

  describe("when the schema constant is PascalCase", () => {
    it("names the interface after the constant itself", () => {
      expect(() =>
        fix(
          'import type { Named } from "@langwatch/module";\nexport const RunEventSchema = z.object({});',
          [
            'import type { Named } from "@langwatch/module";',
            "const RunEventSchemaDefinition = z.object({});",
            "export interface RunEventSchema extends Named<typeof RunEventSchemaDefinition> {}",
            "export const RunEventSchema: RunEventSchema = RunEventSchemaDefinition;",
          ].join("\n"),
        ),
      ).not.toThrow();
    });
  });

  describe("when the schema shares its name with its inferred type", () => {
    it("suffixes the interface with Schema", () => {
      expect(() =>
        fix(
          'import type { Named } from "@langwatch/module";\nexport const Message = z.object({});\nexport type Message = z.infer<typeof Message>;',
          [
            'import type { Named } from "@langwatch/module";',
            "const MessageDefinition = z.object({});",
            "export interface MessageSchema extends Named<typeof MessageDefinition> {}",
            "export const Message: MessageSchema = MessageDefinition;",
            "export type Message = z.infer<typeof Message>;",
          ].join("\n"),
        ),
      ).not.toThrow();
    });
  });

  describe("when the interface name is already taken", () => {
    it("reports without a fix", () => {
      const found = report(
        'import { z } from "zod";\nexport type AgentSchema = string;\nexport const agentSchema = z.object({});',
      );

      expect(found).toHaveLength(1);
      expect(found[0].fix).toBeUndefined();
    });
  });
});

describe("given a file outside a contract", () => {
  /** @scenario "Schemas outside a contract pass" */
  it("reports nothing", () => {
    expect(
      report("export const agentSchema = z.object({});", "modules/agent/process/src/agent.ts"),
    ).toHaveLength(0);
  });
});
