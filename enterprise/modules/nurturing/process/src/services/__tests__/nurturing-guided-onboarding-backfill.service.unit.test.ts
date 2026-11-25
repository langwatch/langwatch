// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingGuidedOnboardingBackfillService } from "../nurturing-guided-onboarding-backfill.service.ts";
import { NurturingService } from "../nurturing.service.ts";

/** A Customer.io channel that keeps each batch, and refuses the next `refusals` of them. */
class RecordingChannel extends CustomerIoChannel {
  refusals = 0;
  readonly sent: CioBatchCall[] = [];
  async identifyUser(): Promise<void> {}
  async trackEvent(): Promise<void> {}
  async groupUser(): Promise<void> {}
  async batch(calls: CioBatchCall[]): Promise<void> {
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new Error("Customer.io unavailable");
    }
    this.sent.push(...calls);
  }
}

function sessionStarted(at: number): NurturingSignalOf<"session_started"> {
  return {
    kind: "session_started",
    sourceEventId: `user-1:${at}`,
    tenantId: "user-1",
    occurredAt: at,
    userId: "user-1",
    hasOrganization: true,
  };
}

/** A person whose only organization holds `record`, read through organization's capability. */
async function backfillOver(record: GuidedOnboardingRecord) {
  const channel = new RecordingChannel();
  const members = MemoryNurturingOrganizationMemberRepository.create();
  await members.recordMembershipChange({
    organizationId: "org-1",
    userId: "user-1",
    change: "joined",
    at: 1_000,
  });
  const guided = { record };
  const backfill = NurturingGuidedOnboardingBackfillService.create({
    claims: MemoryNurturingClaimRepository.create(),
    customerIo: NurturingService.create({ channel }),
    members,
    organizations: createApiFixture<OrganizationApi>({
      readGuidedOnboardingState: () => Promise.resolve(guided.record),
    }),
  });
  return { channel, backfill, guided };
}

describe("NurturingGuidedOnboardingBackfillService", () => {
  describe("given a member whose latest organization picked gateway then llmops", () => {
    /** @scenario "a login backfills the picked paths of the person's latest organization, once" */
    it("identifies and groups the picked paths once over two sessions", async () => {
      const { channel, backfill } = await backfillOver({
        state: { paths: ["gateway", "llmops"], donePaths: [] },
        variant: "guided",
      });

      await backfill.deliver(sessionStarted(2_000));
      await backfill.deliver(sessionStarted(3_000));

      expect(channel.sent).toEqual([
        {
          type: "identify",
          userId: "user-1",
          traits: {
            onboarding_variant: "guided",
            onboarding_paths: "gateway,llmops",
            onboarding_primary_path: "gateway",
          },
        },
        {
          type: "group",
          userId: "user-1",
          groupId: "org-1",
          traits: {
            onboarding_variant: "guided",
            onboarding_paths: "gateway,llmops",
            onboarding_primary_path: "gateway",
          },
        },
      ]);
    });
  });

  describe("given a member whose latest organization picked no path yet", () => {
    /** @scenario "a login before any pick sends no backfill and keeps it for a later login" */
    it("sends nothing, then sends the picks on the login after they were made", async () => {
      const { channel, backfill, guided } = await backfillOver({
        state: { paths: [], donePaths: [] },
        variant: "guided",
      });

      await backfill.deliver(sessionStarted(2_000));
      expect(channel.sent).toEqual([]);

      guided.record = { state: { paths: ["governance"], donePaths: [] }, variant: "guided" };
      await backfill.deliver(sessionStarted(3_000));

      expect(channel.sent[0]).toMatchObject({
        type: "identify",
        traits: { onboarding_primary_path: "governance" },
      });
    });
  });

  describe("given Customer.io refuses the first backfill", () => {
    /** @scenario "a backfill whose send fails is sent on the next login" */
    it("gives the claim back, so the next session sends it", async () => {
      const { channel, backfill } = await backfillOver({
        state: { paths: ["gateway"], donePaths: [] },
        variant: "guided",
      });
      channel.refusals = 1;

      await backfill.deliver(sessionStarted(2_000));
      expect(channel.sent).toEqual([]);
      await backfill.deliver(sessionStarted(3_000));

      expect(channel.sent.map((call) => call.type)).toEqual(["identify", "group"]);
    });
  });

  describe("given organization's read fails", () => {
    it("returns normally and sends nothing, so the login's own delivery stands", async () => {
      const channel = new RecordingChannel();
      const members = MemoryNurturingOrganizationMemberRepository.create();
      await members.recordMembershipChange({
        organizationId: "org-1",
        userId: "user-1",
        change: "joined",
        at: 1_000,
      });
      const backfill = NurturingGuidedOnboardingBackfillService.create({
        claims: MemoryNurturingClaimRepository.create(),
        customerIo: NurturingService.create({ channel }),
        members,
        organizations: createApiFixture<OrganizationApi>({
          readGuidedOnboardingState: () => Promise.reject(new Error("organization unavailable")),
        }),
      });

      await expect(backfill.deliver(sessionStarted(2_000))).resolves.toBeUndefined();
      expect(channel.sent).toEqual([]);
    });
  });
});
