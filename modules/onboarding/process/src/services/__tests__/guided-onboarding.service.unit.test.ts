/**
 * The organization module's `readGuidedOnboardingState`/`writeGuidedOnboardingState`
 * have no process-side implementation yet (contract only), so every scenario
 * that would exercise a real read or write is not bound here yet. This file
 * covers what needs no peer call: the guard clause every mutator runs first.
 *
 * @scenario "an unknown path is refused before any organization call"
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { GuidedOnboardingPathUnknownError } from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogEventsChannel } from "../../channels/memory/memory.posthog-events.channel.ts";
import { GuidedOnboardingService } from "../guided-onboarding.service.ts";

function createService(): GuidedOnboardingService {
  return GuidedOnboardingService.create({
    organizations: createApiFixture<OrganizationApi>({}),
    events: MemoryPostHogEventsChannel.create(),
  });
}

describe("GuidedOnboardingService path guards", () => {
  it("refuses an unknown path on completePath before touching the organization", async () => {
    const service = createService();

    await expect(
      service.completePath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  it("refuses an unknown path on beginPath before touching the organization", async () => {
    const service = createService();

    await expect(
      service.beginPath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  it("refuses an unknown path in recordPaths before touching the organization", async () => {
    const service = createService();

    await expect(
      service.recordPaths({ organizationId: "org_1", userId: "user_1" }, { paths: ["billing"] }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });
});
