import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { GovernanceCodingAgentBillingService } from "../coding-agent-cost-attribution.service.ts";

const billing = GovernanceCodingAgentBillingService.create({
  governance: createApiFixture<GovernanceRestApi>({
    isSourceBilled: async ({ sourceType }) => sourceType === "codex",
  }),
});

describe("GovernanceCodingAgentBillingService", () => {
  /** @scenario "a bundled source reads as not billed and a per-token source as billed" */
  it("answers from the governance bundled-plan policy", async () => {
    await expect(
      billing.isSourceNonBillable({ organizationId: "org-1", sourceType: "claude_code" }),
    ).resolves.toBe(true);
    await expect(
      billing.isSourceNonBillable({ organizationId: "org-1", sourceType: "codex" }),
    ).resolves.toBe(false);
  });
});
