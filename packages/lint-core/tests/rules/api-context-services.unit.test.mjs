import { afterAll, describe, expect, it } from "vitest";
import { apiContextServicesRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const API = "packages/features/agent/server/src/transport/api-rest/agent.api.ts";

function report(code) {
  return runRule(apiContextServicesRule, { code, cwd: workspace.cwd, filename: API });
}

describe("given a strict feature API module", () => {
  describe("when it constructs a *Service directly", () => {
    /** @scenario "Constructing a service inside an API class is reported by name" */
    it("reports construction naming the class", () => {
      const found = report("export class AgentApi { run() { return new AgentService(); } }");

      expect(found.map((entry) => entry.messageId)).toEqual(["construction"]);
      expect(found[0].data.name).toBe("AgentService");
      expect(found[0].message).toBe(
        "`new AgentService` inside an API class." +
          " Take it from `context.app` and let the composition root construct it.",
      );
    });
  });

  describe("when it double-awaits a resolved call", () => {
    /** @scenario "A double-await in an API class is reported" */
    it("reports doubleAwait", () => {
      const found = report(
        "export class AgentApi { async run() { return await (await this.resolve()).call(); } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["doubleAwait"]);
    });
  });

  describe("when it calls this.options as a per-request resolver", () => {
    /** @scenario "Calling this.options as a resolver is reported" */
    it("reports resolver", () => {
      const found = report("export class AgentApi { run() { return this.options.resolve(); } }");

      expect(found.map((entry) => entry.messageId)).toEqual(["resolver"]);
    });
  });

  describe("when it casts the context to recover a service", () => {
    /** @scenario "Casting the API context is reported" */
    it("reports contextCast", () => {
      const found = report(
        "export class AgentApi { run(c) { return (c as unknown as { app: unknown }).app; } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["contextCast"]);
    });
  });
});
