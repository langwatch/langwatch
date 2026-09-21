import { afterAll, describe, expect, it } from "vitest";
import { restSchemaFromOwnContractRule } from "../../src/rules/rest-schema-from-own-contract.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { contract: {}, process: {} } },
    experiment: { layoutVersion: 0, roles: { contract: {}, process: {} } },
  },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(restSchemaFromOwnContractRule, { code, cwd: workspace.cwd, filename });
}

describe("given a REST transport file", () => {
  describe("when it builds a schema inline with z.object", () => {
    /** @scenario "An inline z.object() in a REST transport file is reported" */
    it("reports inlineSchema", () => {
      const found = report(
        'import { z } from "zod";\n' +
          'import { defineRestRouter } from "@langwatch/api/rest";\n' +
          'import { AgentApi } from "@langwatch/agent-contract";\n' +
          "export const agentRest = defineRestRouter(AgentApi)\n" +
          '  .post("/agents", "createAgent")\n' +
          "  .withInput(z.object({ name: z.string() }))\n" +
          "  .handle(() => {});",
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["inlineSchema"]);
      expect(found[0].data.factory).toBe("object");
    });
  });

  describe("when it builds a schema inline with z.enum", () => {
    /** @scenario "An inline z.enum() in a REST transport file is reported" */
    it("reports inlineSchema", () => {
      const found = report(
        'import { z } from "zod";\nconst kinds = z.enum(["a", "b"]);',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["inlineSchema"]);
    });
  });

  describe("when the same factory name comes from something other than zod", () => {
    /** @scenario "A same-named factory not imported from zod is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "./local-zod-lookalike.ts";\nconst shape = z.object({});',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a schema is built inside the handler's own body", () => {
    /** @scenario "A schema built at runtime inside a handler body is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod";\n' +
          'export const agentRest = router.post("/agents", "createAgent").handle(() => {\n' +
          "  const shape = z.object({ name: z.string() });\n" +
          "  return shape;\n" +
          "});",
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it imports a schema from its own module's contract", () => {
    /** @scenario "Importing a schema from the module's own contract is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { createAgentSchema } from "@langwatch/agent-contract";',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it imports a schema from another module's contract", () => {
    /** @scenario "Importing a schema from another module's contract is reported" */
    it("reports foreignContract", () => {
      const found = report(
        'import { experimentSummarySchema } from "@langwatch/experiment-contract";',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["foreignContract"]);
      expect(found[0].data).toEqual({ source: "@langwatch/experiment-contract", module: "agent" });
    });
  });

  describe("when it imports a subpath of another module's contract", () => {
    /** @scenario "Importing a subpath of another module's contract is reported" */
    it("reports foreignContract", () => {
      const found = report(
        'import { x } from "@langwatch/experiment-contract/experiment-schemas";',
        "modules/agent/process/src/transport/agent.rest.ts",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["foreignContract"]);
    });
  });

  describe("when it imports from an unrelated non-contract package", () => {
    /** @scenario "Importing an unrelated non-contract package is not this rule's business" */
    it("reports nothing", () => {
      const found = report('import { z } from "zod";', "modules/agent/process/src/transport/agent.rest.ts");

      expect(found).toEqual([]);
    });
  });
});

describe("given a server file outside transport", () => {
  describe("when it is a service, not a .rest.ts or .trpc.ts file", () => {
    /** @scenario "A non-transport server file is not this rule's business" */
    it("reports nothing", () => {
      const found = report(
        'import { z } from "zod"; const shape = z.object({ id: z.string() });',
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});
