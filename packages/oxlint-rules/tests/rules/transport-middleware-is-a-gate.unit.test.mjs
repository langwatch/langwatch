import { afterAll, describe, expect, it } from "vitest";
import { transportMiddlewareIsAGateRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(transportMiddlewareIsAGateRule, { code, cwd: workspace.cwd, filename });
}

describe("given a module transport file", () => {
  describe("when a middleware fact is named like a capability", () => {
    /** @scenario "A middleware fact named after a capability is not a gate" */
    it("reports reservedName", () => {
      const found = report(
        "export const agentRestEffects = defineRestMiddleware('agentRestEffects', z.object({}));",
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("reservedName");
      expect(found[0].data.name).toBe("agentRestEffects");
    });
  });

  describe("when a middleware fact has a function-typed field", () => {
    /** @scenario "A function-typed middleware field is a capability in disguise" */
    it("reports functionMember", () => {
      const found = report(
        "export const agentRestCredential = defineRestMiddleware('agentRestCredential', z.object({ reportError: z.custom<(error: Error) => void>() }));",
        "modules/agent/server/src/transport/agent.rest.ts",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("functionMember");
      expect(found[0].data.field).toBe("reportError");
    });
  });

  describe("when a middleware fact carries only credential fields", () => {
    /** @scenario "A credential-only middleware fact is a gate" */
    it("reports nothing", () => {
      expect(
        report(
          "export const agentRestCredential = defineRestMiddleware('agentRestCredential', z.object({ apiKey: z.string() }));",
          "modules/agent/server/src/transport/agent.rest.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is not a transport file", () => {
    /** @scenario "A middleware-shaped call outside transport is not governed" */
    it("reports nothing", () => {
      expect(
        report(
          "export const agentRestEffects = defineRestMiddleware('agentRestEffects', z.object({}));",
          "modules/agent/server/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
