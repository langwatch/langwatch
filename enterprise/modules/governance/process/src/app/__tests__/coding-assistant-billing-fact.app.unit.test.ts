// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/governance/specs/governance-deploy-steps.feature
 */
import { ASSISTANT_KINDS, GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { bootGovernanceWorker } from "../../migrations/__tests__/governance-deploy-steps.fixture.ts";

describe("given an installed governance app", () => {
  describe("when an admin saves a coding-assistant tile", () => {
    /** @scenario "An admin's coding-assistant edit stores its billed facts" */
    it("stores one billed fact per assistant kind on the billing pipeline", async () => {
      const { runtime, billedFacts } = await bootGovernanceWorker();
      try {
        const app = runtime.service(GovernanceRestApi);

        await app.aiToolCreate({
          organizationId: "org_edit",
          departmentIds: [],
          type: "coding_assistant",
          displayName: "Codex",
          config: { assistantKind: "codex", setupCommand: "npm i -g codex", bundledPlan: false },
        });

        const stored = await Promise.all(
          ASSISTANT_KINDS.map((sourceType) =>
            billedFacts({ organizationId: "org_edit", sourceType }),
          ),
        );
        expect(stored.map((facts) => facts.length)).toEqual(ASSISTANT_KINDS.map(() => 1));
      } finally {
        await runtime.stop();
      }
    });
  });
});
