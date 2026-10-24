import { afterAll, describe, expect, it } from "vitest";

import { noCallerBoundBypassRule } from "../../src/rules/no-caller-bound-bypass.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const CONTRACT = "modules/agent/contract/src/agent.api.ts";
const PROCESS = "modules/agent/process/src/services/agent.service.ts";

function report(code, filename = CONTRACT) {
  return runRule(noCallerBoundBypassRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ data, line, messageId }),
  );
}

describe("given a module's contract", () => {
  describe("when an input type carries a bypass boolean", () => {
    /** @scenario "A bypass property on an Api input is reported" */
    it("reports callerBoundBypass for each bypass-shaped name", () => {
      const code = [
        "export interface RunAgentInput {",
        "  agentId: string;",
        "  isExempt?: boolean;",
        "  exemptFromLimits: boolean;",
        "  bypassQuota: boolean;",
        "  skipRateLimit?: boolean;",
        "  skipConcurrencyLimit?: boolean;",
        "  ignoreLimits?: boolean;",
        "}",
      ].join("\n");

      expect(report(code).map(({ data, line }) => [data.name, line])).toEqual([
        ["isExempt", 3],
        ["exemptFromLimits", 4],
        ["bypassQuota", 5],
        ["skipRateLimit", 6],
        ["skipConcurrencyLimit", 7],
        ["ignoreLimits", 8],
      ]);
    });

    /** @scenario "A bypass key in a Zod input shape is reported" */
    it("reports a key of a z.object shape", () => {
      const code =
        'import { z } from "zod";\nexport const runSchema = z.object({ agentId: z.string(), bypassLimit: z.boolean() });';

      expect(report(code)).toEqual([
        { data: { name: "bypassLimit" }, line: 2, messageId: "callerBoundBypass" },
      ]);
    });

    /** @scenario "The report asks for an origin" */
    it("names the origin in the fix", () => {
      const [finding] = runRule(noCallerBoundBypassRule, {
        code: "export interface A { isExempt: boolean }",
        cwd: workspace.cwd,
        filename: CONTRACT,
      });

      expect(finding.message).toContain("origin of the call");
    });
  });

  describe("when an input names where the call came from", () => {
    /** @scenario "An origin and unrelated skip names are accepted" */
    it("reports nothing", () => {
      const code = [
        "export interface RunAgentInput {",
        '  origin: "api" | "ui" | "scheduler";',
        "  skipCache?: boolean;",
        "  skipValidation?: boolean;",
        "  limit: number;",
        "}",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the file is not contract production code", () => {
    /** @scenario "Process code and tests are left alone" */
    it("reports nothing", () => {
      const code = "export interface A { isExempt: boolean }";

      expect(report(code, PROCESS)).toEqual([]);
      expect(report(code, "modules/agent/contract/src/__tests__/agent.unit.test.ts")).toEqual([]);
    });
  });
});
