import { afterAll, describe, expect, it } from "vitest";

import { schemaOutsideContractRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
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
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("schema");
      expect(found[0].message).toBe(
        "`CreateAgentSchema` is a Zod schema declared in" +
          " `modules/agent/process/src/transport/agent.rest.ts`." +
          " Move it to `modules/agent/contract/src` and import it here.",
      );
    });
  });

  describe("when it authors the schema through another zod entrypoint", () => {
    /** @scenario "A Zod schema authored through zod/v4 or zod/mini is reported" */
    it.each(["zod/v4", "zod/mini"])("reports schema for %s on the declaring line", (entrypoint) => {
      const found = report(
        `import { z } from "${entrypoint}";\nconst CreateAgentSchema = z.object({ name: z.string() });`,
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((finding) => [finding.data.name, finding.line])).toEqual([
        ["CreateAgentSchema", 2],
      ]);
    });
  });

  describe("when it exports a top-level z.object() without a Schema suffix", () => {
    /** @scenario "An exported top-level Zod object without a Schema suffix is reported" */
    it("reports schema", () => {
      const found = report(
        'import { z } from "zod"; export const CreateAgent = z.object({ name: z.string() });',
        "modules/agent/process/src/transport/agent.rest.ts",
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
        "modules/agent/process/src/transport/agent.rest.ts",
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
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((e) => e.data.name)).toEqual(["pageQuerySchema", "budgetListQuerySchema"]);
    });
  });

  describe("when a non-exported constant has no Schema suffix", () => {
    /** @scenario "A non-exported non-Schema-named constant is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod"; const agentShape = z.object({ name: z.string() });',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a process file outside transport", () => {
  describe("when it declares a top-level Schema constant", () => {
    /** @scenario "A Zod schema outside transport is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod"; const InternalSchema = z.object({ id: z.string() });',
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
