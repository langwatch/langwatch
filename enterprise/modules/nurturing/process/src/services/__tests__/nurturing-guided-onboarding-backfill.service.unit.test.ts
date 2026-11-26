// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import { NurturingGuidedOnboardingBackfillService } from "../nurturing-guided-onboarding-backfill.service.ts";
import { NurturingService } from "../nurturing.service.ts";
import { peopleWithEmails } from "./nurturing-person-email.test-helpers.ts";

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

const LOGIN_AT = 1_792_664_000_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Claims that hold as Redis would, but whose release always fails. */
function claimsWhoseReleaseFails(): NurturingClaimRepository {
  const memory = MemoryNurturingClaimRepository.create();
  return {
    claim: (key, ttlSeconds) => memory.claim(key, ttlSeconds),
    release: () => Promise.reject(new Error("redis unavailable")),
  };
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
async function backfillOver(
  record: GuidedOnboardingRecord,
  claims: NurturingClaimRepository = MemoryNurturingClaimRepository.create(),
) {
  const channel = new RecordingChannel();
  const members = MemoryNurturingOrganizationMemberRepository.create();
  await members.recordMembershipChange({
    organizationId: "org-1",
    userId: "user-1",
    change: "joined",
    at: 1_000,
  });
  const guided = {
    record,
    read: (): Promise<GuidedOnboardingRecord> => Promise.resolve(guided.record),
  };
  const backfill = NurturingGuidedOnboardingBackfillService.create({
    claims,
    customerIo: NurturingService.create({ users: peopleWithEmails(), channel }),
    members,
    organizations: createApiFixture<OrganizationApi>({
      readGuidedOnboardingState: () => guided.read(),
    }),
  });
  return { channel, backfill, guided };
}

describe("NurturingGuidedOnboardingBackfillService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LOGIN_AT);
  });
  afterEach(() => vi.useRealTimers());

  describe("given a member whose latest organization picked gateway then llmops", () => {
    /** @scenario "a login backfills the picked paths of the person's latest organization, once" */
    it("identifies the picked paths once, even on a session long after the first", async () => {
      const { channel, backfill } = await backfillOver({
        state: { paths: ["gateway", "llmops"], donePaths: [] },
        variant: "guided",
      });

      await backfill.deliver(sessionStarted(2_000));
      vi.setSystemTime(LOGIN_AT + TWO_HOURS_MS);
      await backfill.deliver(sessionStarted(3_000));

      expect(channel.sent).toEqual([
        {
          type: "identify",
          userId: "user-1",
          traits: {
            onboarding_variant: "guided",
            onboarding_paths: "gateway,llmops",
            onboarding_primary_path: "gateway",
            email: "user-1@example.com",
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

  describe("given another member's pick lands while the backfill takes its claim", () => {
    /** @scenario "a backfill sends the state read after its claim" */
    it("sends the organization's newer picks", async () => {
      const memory = MemoryNurturingClaimRepository.create();
      const onClaim = { run: () => {} };
      const claims: NurturingClaimRepository = {
        claim: (key, ttlSeconds) => {
          onClaim.run();
          return memory.claim(key, ttlSeconds);
        },
        release: (key) => memory.release(key),
      };
      const { channel, backfill, guided } = await backfillOver(
        { state: { paths: ["gateway"], donePaths: [] }, variant: "guided" },
        claims,
      );
      onClaim.run = () => {
        guided.record = {
          state: { paths: ["llmops", "gateway"], donePaths: [] },
          variant: "guided",
        };
      };

      await backfill.deliver(sessionStarted(2_000));

      expect(channel.sent).toMatchObject([
        { type: "identify", traits: { onboarding_primary_path: "llmops" } },
        { type: "group", traits: { onboarding_primary_path: "llmops" } },
      ]);
    });
  });

  describe("given a member whose backfill was already sent", () => {
    /** @scenario "a sent backfill reads nothing on a later login" */
    it("reads no organization state on the next session", async () => {
      const { channel, backfill, guided } = await backfillOver({
        state: { paths: ["gateway"], donePaths: [] },
        variant: "guided",
      });
      await backfill.deliver(sessionStarted(2_000));
      const reads: string[] = [];
      const read = guided.read;
      guided.read = () => {
        reads.push("organization");
        return read();
      };

      vi.setSystemTime(LOGIN_AT + TWO_HOURS_MS);
      await backfill.deliver(sessionStarted(3_000));

      expect(reads).toEqual([]);
      expect(channel.sent.map((call) => call.type)).toEqual(["identify", "group"]);
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

    describe("and giving its claim back fails too", () => {
      /** @scenario "a backfill whose send and claim release both fail is sent on a later login" */
      it("sends it on a login after the attempt's hour has passed", async () => {
        const { channel, backfill } = await backfillOver(
          { state: { paths: ["gateway"], donePaths: [] }, variant: "guided" },
          claimsWhoseReleaseFails(),
        );
        channel.refusals = 1;

        await backfill.deliver(sessionStarted(2_000));
        vi.setSystemTime(LOGIN_AT + TWO_HOURS_MS);
        await backfill.deliver(sessionStarted(3_000));

        expect(channel.sent).toMatchObject([
          { type: "identify", traits: { onboarding_primary_path: "gateway" } },
          { type: "group", traits: { onboarding_primary_path: "gateway" } },
        ]);
      });
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
        customerIo: NurturingService.create({ users: peopleWithEmails(), channel }),
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
