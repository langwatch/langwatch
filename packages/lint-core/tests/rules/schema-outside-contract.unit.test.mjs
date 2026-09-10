import { afterAll, describe, expect, it } from "vitest";
import { schemaOutsideContractRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(schemaOutsideContractRule, { code, cwd: workspace.cwd, filename });
}

describe("given a transport file", () => {
  describe("when it declares a top-level Schema constant from z", () => {
    /** @scenario "A Zod schema authored in a transport file is reported" */
    it("reports schema and names the contract package", () => {
      const found = report(
        'import { z } from "zod"; const CreateAgentSchema = z.object({ name: z.string() });',
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("schema");
      expect(found[0].message).toBe(
        "`CreateAgentSchema` is a Zod schema declared in" +
          " `modules/agent/server/src/transport/agent.rest.ts`." +
          " Move it to `modules/agent/contract/src` and import it here.",
      );
    });
  });

  describe("when it exports a top-level z.object() without a Schema suffix", () => {
    /** @scenario "An exported top-level Zod object without a Schema suffix is reported" */
    it("reports schema", () => {
      const found = report(
        'import { z } from "zod"; export const CreateAgent = z.object({ name: z.string() });',
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found.map((e) => e.messageId)).toEqual(["schema"]);
    });
  });

  describe("when the schema composes an imported contract schema", () => {
    /** @scenario "Composing an imported contract schema is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { AgentBaseSchema } from "@langwatch/agent-contract"; ' +
          "const CreateAgentSchema = AgentBaseSchema.extend({ name: 1 });",
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the schema composes a schema this same file authors", () => {
    /** @scenario "Composing a schema authored in the same transport file is reported" */
    it("reports both the base schema and the schema derived from it", () => {
      const found = report(
        'import { z } from "zod"; ' +
          "const pageQuerySchema = z.object({ page: z.number() }); " +
          "const budgetListQuerySchema = pageQuerySchema.extend({ budget: z.number() });",
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found.map((e) => e.data.name).sort()).toEqual([
        "budgetListQuerySchema",
        "pageQuerySchema",
      ]);
    });
  });

  describe("when a non-exported constant has no Schema suffix", () => {
    /** @scenario "A non-exported non-Schema-named constant is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod"; const agentShape = z.object({ name: z.string() });',
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a server file outside transport", () => {
  describe("when it declares a top-level Schema constant", () => {
    /** @scenario "A Zod schema outside transport is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod"; const InternalSchema = z.object({ id: z.string() });',
        "modules/agent/server/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
