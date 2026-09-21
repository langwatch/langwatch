/**
 * Save-time refusal pin for the new run-time agent-under-test key (issue
 * #6634, AC-N7) — mirrors the existing DEFAULT-role and feature-override
 * refusal pattern (setRoleAtScope / setFeatureAtScope, both already refuse
 * codex on every other DEFAULT-role feature; codexRestrictions.unit.test.ts
 * pins the underlying gate). Both refusals happen synchronously before any
 * database access, so a bogus `prisma` stands in safely — these tests never
 * reach it.
 *
 * @see specs/model-providers/codex-account-provider.feature
 *   ("The server refuses Codex outside the allowed surfaces")
 */
import { describe, expect, it } from "vitest";

import { CODEX_DEFAULT_MODEL } from "../codexRestrictions";
import { setFeatureAtScope, setRoleAtScope } from "../modelDefaults.service";

// Neither refusal path under test reaches the database — both throw
// synchronously from validation before any prisma call.
const unusedPrisma = undefined as never;

describe("modelDefaults.service — codex refusal for the run-time agent-under-test surface", () => {
  describe("given a DEFAULT role default set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        setRoleAtScope(
          { prisma: unusedPrisma },
          {
            scopeType: "PROJECT",
            scopeId: "proj-1",
            role: "DEFAULT",
            model: CODEX_DEFAULT_MODEL,
          },
        ),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("given a scenarios.agent_under_test feature override set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        setFeatureAtScope(
          { prisma: unusedPrisma },
          {
            scopeType: "PROJECT",
            scopeId: "proj-1",
            featureKey: "scenarios.agent_under_test",
            model: CODEX_DEFAULT_MODEL,
          },
        ),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });
});
