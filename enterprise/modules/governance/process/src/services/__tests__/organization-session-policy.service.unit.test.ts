import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { OrganizationSessionPolicyService } from "../organization-session-policy.service.ts";

describe("OrganizationSessionPolicyService", () => {
  describe("when an admin sets a new ceiling", () => {
    it("saves it on the organization, then applies it to the open sessions", async () => {
      const steps: string[] = [];
      const service = OrganizationSessionPolicyService.create({
        organizations: createApiFixture<OrganizationApi>({
          saveSessionPolicy: async ({ maxSessionDurationDays }) => {
            steps.push(`save ${maxSessionDurationDays}`);
          },
        }),
        loginKeys: createApiFixture<ApiKeyApi>({
          applySessionCeiling: async ({ organizationId, maxSessionDurationDays }) => {
            steps.push(`apply ${organizationId} ${maxSessionDurationDays}`);
            return 3;
          },
        }),
      });

      await expect(
        service.setMaxDuration({ organizationId: "org_1", maxSessionDurationDays: 7 }),
      ).resolves.toEqual({ ok: true, reapedSessions: 3 });
      expect(steps).toEqual(["save 7", "apply org_1 7"]);
    });
  });
});
