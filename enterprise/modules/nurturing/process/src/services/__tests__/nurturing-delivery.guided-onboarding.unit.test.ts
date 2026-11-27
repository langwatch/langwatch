// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type {
  CioBatchCall,
  CioOrgTraits,
  CioPersonTraits,
  NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingGuidedOnboardingBackfillService } from "../nurturing-guided-onboarding-backfill.service.ts";
import { NurturingService } from "../nurturing.service.ts";
import { unplacedMemberFacts } from "./nurturing-member-facts.test-helpers.ts";
import { peopleWithEmails } from "./nurturing-person-email.test-helpers.ts";

/** Every call Customer.io was handed, single or batched, in the order; refuses batches on ask. */
class RecordingChannel extends CustomerIoChannel {
  refusing = false;
  readonly sent: CioBatchCall[] = [];
  async identifyUser(input: { userId: string; traits: Partial<CioPersonTraits> }): Promise<void> {
    this.sent.push({ type: "identify", ...input });
  }
  async trackEvent(): Promise<void> {}
  async groupUser(input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {
    this.sent.push({ type: "group", ...input });
  }
  async batch(calls: CioBatchCall[]): Promise<void> {
    if (this.refusing) throw new Error("Customer.io refused");
    this.sent.push(...calls);
  }
}

/** Lets the fire-and-forget sends settle before the assertions read them. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function deliveryWithGuidedOrganization() {
  const channel = new RecordingChannel();
  const customerIo = NurturingService.create({ users: peopleWithEmails(), channel });
  const claims = MemoryNurturingClaimRepository.create();
  const members = MemoryNurturingOrganizationMemberRepository.create();
  await members.recordMembershipChange({
    organizationId: "org-1",
    userId: "user-1",
    change: "joined",
    at: 1_000,
  });
  const delivery = NurturingDeliveryService.create({
    claims,
    customerIo,
    posthog: undefined,
    users: createApiFixture<UserApi>({}),
    memberFacts: unplacedMemberFacts(),
    members,
    erasedUsers: MemoryNurturingErasedUserRepository.create(),
    guidedBackfill: NurturingGuidedOnboardingBackfillService.create({
      claims,
      customerIo,
      members,
      organizations: createApiFixture<OrganizationApi>({
        readGuidedOnboardingState: () =>
          Promise.resolve({ state: { paths: ["governance"], donePaths: [] }, variant: "guided" }),
      }),
    }),
  });
  return { channel, delivery };
}

const variantAssigned: NurturingSignal = {
  kind: "onboarding_variant_assigned",
  sourceEventId: "org-1",
  tenantId: "org-1",
  occurredAt: 1_500,
  userId: "user-1",
  organizationId: "org-1",
  variant: "guided",
};

describe("NurturingDeliveryService for guided onboarding", () => {
  describe("when an organization is assigned the guided variant", () => {
    /** @scenario "the assigned experiment variant reaches the creator and the organization" */
    it("identifies the creator and groups the organization with the variant alone", async () => {
      const { channel, delivery } = await deliveryWithGuidedOrganization();
      await delivery.deliver({ key: "onboarding_variant_assigned:org-1", signal: variantAssigned });
      await settle();

      expect(channel.sent).toEqual([
        {
          type: "identify",
          userId: "user-1",
          traits: { onboarding_variant: "guided", email: "user-1@example.com" },
        },
        {
          type: "group",
          userId: "user-1",
          groupId: "org-1",
          traits: { onboarding_variant: "guided" },
        },
      ]);
    });

    /** @scenario "a refused variant assignment fails its delivery, so its job retries" */
    it("rejects while Customer.io refuses, then sends the variant on the retry", async () => {
      const { channel, delivery } = await deliveryWithGuidedOrganization();
      const key = "onboarding_variant_assigned:org-1";
      channel.refusing = true;

      await expect(delivery.deliver({ key, signal: variantAssigned })).rejects.toThrow(
        "Customer.io refused",
      );
      channel.refusing = false;
      await delivery.deliver({ key, signal: variantAssigned });

      expect(channel.sent).toEqual([
        {
          type: "identify",
          userId: "user-1",
          traits: { onboarding_variant: "guided", email: "user-1@example.com" },
        },
        {
          type: "group",
          userId: "user-1",
          groupId: "org-1",
          traits: { onboarding_variant: "guided" },
        },
      ]);
    });
  });

  describe("when a member of an organization that picked governance starts a session", () => {
    /** @scenario "a login backfills the picked paths of the person's latest organization, once" */
    it("sends the backfill beside the session's own activity", async () => {
      const { channel, delivery } = await deliveryWithGuidedOrganization();
      const signal: NurturingSignal = {
        kind: "session_started",
        sourceEventId: "user-1:2000",
        tenantId: "user-1",
        occurredAt: 2_000,
        userId: "user-1",
        hasOrganization: true,
      };

      await delivery.deliver({ key: "session_started:user-1:2000", signal });
      await settle();

      expect(channel.sent).toContainEqual({
        type: "group",
        userId: "user-1",
        groupId: "org-1",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "governance",
          onboarding_primary_path: "governance",
        },
      });
    });
  });
});
