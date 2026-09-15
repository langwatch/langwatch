import { afterAll, describe, expect, it } from "vitest";
import { awaitedReturnChainRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";

function report(code) {
  return runRule(awaitedReturnChainRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

describe("given a strict feature service module", () => {
  describe("when a return chains a call off an inline await", () => {
    /** @scenario "A chained await in a return statement is reported" */
    it("reports awaitedReturnChain", () => {
      const found = report(
        "export class AgentService { async run() { return (await this.repo.find()).value; } }",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("awaitedReturnChain");
    });
  });

  describe("when the awaited value is named first", () => {
    /** @scenario "A named await before the return is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "export class AgentService { async run() { const found = await this.repo.find(); return found.value; } }",
        ),
      ).toEqual([]);
    });
  });
});
