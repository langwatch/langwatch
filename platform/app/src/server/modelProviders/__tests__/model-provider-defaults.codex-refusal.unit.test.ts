/**
 * Save-time refusal pin for the new run-time agent-under-test key (issue
 * #6634, AC-N7) — exercises the canonical default writer's DEFAULT-role and
 * feature-override refusal. `codexRestrictions.unit.test.ts`
 * pins the underlying gate). Both refusals happen synchronously before any
 * database access, so a bogus `prisma` stands in safely — these tests never
 * reach it.
 *
 * @see specs/model-providers/codex-account-provider.feature
 *   ("The server refuses Codex outside the allowed surfaces")
 */
import { describe, expect, it } from "vitest";

import { CODEX_DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { getApp } from "~/server/app-layer";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

wireDefaultTestApp();

describe("model provider defaults — codex refusal for the run-time agent-under-test surface", () => {
  describe("given a DEFAULT role default set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        getApp().modelProviders.setDefault({
          scope: { scopeType: "PROJECT", scopeId: "proj-1" },
          key: "DEFAULT",
          model: CODEX_DEFAULT_MODEL,
        }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("given a scenarios.agent_under_test feature override set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        getApp().modelProviders.setDefault({
          scope: { scopeType: "PROJECT", scopeId: "proj-1" },
          key: "scenarios.agent_under_test",
          model: CODEX_DEFAULT_MODEL,
        }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });
});
