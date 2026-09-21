/**
 * The seats a connected install may fill (ADR-139, section 6).
 *
 * The lease is the only thing that widens the licensed count, and it is read
 * where plan limits are resolved, so every caller of the seat guard sees the
 * same number. A lease we did not sign, one naming another license or another
 * install, and one past its 30 days all leave the plain licensed cap in place.
 *
 * @see ../installedLease.ts
 * @see ../../../licenseHandler.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { assertMemberTypeLimitNotExceeded } from "~/server/license-enforcement/license-limit-guard";
import { LEASE_VALID_DAYS, LEASE_WARN_AFTER_DAYS } from "../../lease";

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    usageLimits: {
      notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

const { connectEnabled } = vi.hoisted(() => ({
  connectEnabled: { current: true },
}));

vi.mock("../connectConfig", () => ({
  readConnectConfig: () => ({
    permitted: connectEnabled.current,
    gatewayEndpoint: "https://gateway.example.test",
    licenseEndpoint: "https://connect.example.test",
  }),
}));

import { LicenseHandler } from "../../../licenseHandler";
import { resetInstanceIdentity } from "../instanceIdentity";
import {
  credentialOf,
  INSTANCE_ID,
  instanceIdentityTable,
  LANGWATCH_KEYS,
  LICENSE,
  leaseFor,
  mintLicense,
  NOW,
  ORGANIZATION_ID,
  STRANGER_KEYS,
  tamperedLease,
} from "./installFakes";

const LICENSED_SEATS = 50;
const ALLOWANCE = 5;

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function prismaWith(lease: unknown) {
  return {
    organization: {
      findUnique: vi.fn(async () => ({
        id: ORGANIZATION_ID,
        license: LICENSE.licenseKey,
        connectLease: lease,
      })),
    },
    instanceIdentity: instanceIdentityTable(),
  } as never;
}

function repositoryWith(memberCount: number): ILicenseEnforcementRepository {
  return {
    getMemberCount: vi.fn().mockResolvedValue(memberCount),
    getMembersLiteCount: vi.fn().mockResolvedValue(0),
    getCurrentMonthCost: vi.fn(),
    getCurrentMonthCostForProjects: vi.fn(),
  };
}

async function planWith(lease: unknown) {
  const handler = new LicenseHandler({
    prisma: prismaWith(lease),
    publicKey: LANGWATCH_KEYS.publicKey,
    repository: repositoryWith(0),
  });
  return await handler.getSelfHostedPlan(ORGANIZATION_ID);
}

/** What happens when an admin invites one more full member. */
async function inviteAnotherFullMember({
  plan,
  inUse,
}: {
  plan: { maxMembers: number; maxMembersLite: number };
  inUse: number;
}) {
  return await assertMemberTypeLimitNotExceeded(
    "lite-to-full",
    ORGANIZATION_ID,
    repositoryWith(inUse),
    { maxMembers: plan.maxMembers, maxMembersLite: plan.maxMembersLite },
  );
}

beforeEach(() => {
  connectEnabled.current = true;
  resetInstanceIdentity();
  vi.useFakeTimers({ now: NOW });
  return () => vi.useRealTimers();
});

describe("given a connected install holding a lease LangWatch signed", () => {
  describe("when the plan is resolved", () => {
    /** @scenario "A lease with a valid signature is applied" */
    it("adds the allowance the lease carries to the licensed seats", async () => {
      const plan = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS + ALLOWANCE);
      expect(plan.licensedMembers).toBe(LICENSED_SEATS);
      expect(plan.seatOverageAllowance).toBe(ALLOWANCE);
    });
  });

  describe("when every licensed seat is in use", () => {
    /** @scenario "A connected license may go over its seats by the allowance" */
    it("admits another full member", async () => {
      const plan = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE }),
      );

      await expect(
        inviteAnotherFullMember({ plan, inUse: LICENSED_SEATS }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the allowance is in use too", () => {
    /** @scenario "The allowance is a ceiling too" */
    it("refuses the seat past the allowance", async () => {
      const plan = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE }),
      );

      await expect(
        inviteAnotherFullMember({
          plan,
          inUse: LICENSED_SEATS + ALLOWANCE,
        }),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });
  });
});

describe("given a lease that is not ours to act on", () => {
  describe("when its allowance was edited after signing", () => {
    /** @scenario "A lease that was tampered with is ignored" */
    it("is ignored, and the plain licensed cap applies", async () => {
      const plan = await planWith(
        tamperedLease(leaseFor({ seatOverageAllowance: ALLOWANCE })),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
      expect(plan.seatOverageAllowance).toBeUndefined();
    });
  });

  describe("when it names another license", () => {
    /** @scenario "A lease for another license or another instance is ignored" */
    it("is ignored", async () => {
      const other = mintLicense({ maxMembers: 999 });

      const plan = await planWith(
        leaseFor({ licenseId: other.licenseData.licenseId }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
    });
  });

  describe("when it names another install", () => {
    /** @scenario "A lease for another license or another instance is ignored" */
    it("is ignored", async () => {
      const plan = await planWith(
        leaseFor({ instanceId: "org_somebody_else" }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
    });
  });

  describe("when a stranger signed it", () => {
    /** @scenario "A lease that was tampered with is ignored" */
    it("is ignored", async () => {
      const plan = await planWith(
        leaseFor({ privateKey: STRANGER_KEYS.privateKey }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
    });
  });
});

describe("given a lease and a sync that stopped succeeding", () => {
  describe("when it has been failing for less than 14 days", () => {
    /** @scenario "The allowance is kept while sync has failed for less than 14 days" */
    it("keeps the allowance, and another full member is admitted", async () => {
      const plan = await planWith(
        leaseFor({
          seatOverageAllowance: ALLOWANCE,
          issuedAt: daysBefore(10),
        }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS + ALLOWANCE);
      await expect(
        inviteAnotherFullMember({ plan, inUse: LICENSED_SEATS + 2 }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when it has been failing for 20 days", () => {
    /** @scenario "Between day 14 and day 30 the allowance is kept and admins are warned" */
    it("keeps the allowance past the day admins start being warned", async () => {
      expect(LEASE_WARN_AFTER_DAYS).toBe(14);
      const plan = await planWith(
        leaseFor({
          seatOverageAllowance: ALLOWANCE,
          issuedAt: daysBefore(20),
        }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS + ALLOWANCE);
      await expect(
        inviteAnotherFullMember({ plan, inUse: LICENSED_SEATS + 2 }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when it has been failing for more than 30 days", () => {
    /** @scenario "After day 30 the allowance is withdrawn" */
    it("withdraws the allowance and refuses the seat over the license", async () => {
      expect(LEASE_VALID_DAYS).toBe(30);
      const plan = await planWith(
        leaseFor({
          seatOverageAllowance: ALLOWANCE,
          issuedAt: daysBefore(31),
        }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
      await expect(
        inviteAnotherFullMember({ plan, inUse: LICENSED_SEATS + 3 }),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });

    /** @scenario "After day 30 the allowance is withdrawn" */
    it("keeps every seat already in use working", async () => {
      const plan = await planWith(
        leaseFor({
          seatOverageAllowance: ALLOWANCE,
          issuedAt: daysBefore(31),
        }),
      );

      await expect(
        assertMemberTypeLimitNotExceeded(
          "no-change",
          ORGANIZATION_ID,
          repositoryWith(LICENSED_SEATS + 3),
          { maxMembers: plan.maxMembers, maxMembersLite: plan.maxMembersLite },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a sync succeeds again", () => {
    /** @scenario "A sync that succeeds again restores the allowance" */
    it("applies the new lease and the allowance is back", async () => {
      const expired = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE, issuedAt: daysBefore(31) }),
      );
      expect(expired.maxMembers).toBe(LICENSED_SEATS);

      const renewed = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE, issuedAt: NOW }),
      );

      expect(renewed.maxMembers).toBe(LICENSED_SEATS + ALLOWANCE);
    });
  });
});

describe("given an air-gapped install", () => {
  describe("when Connect is switched off for the deployment", () => {
    /** @scenario "An air-gapped install keeps the hard cap" */
    it("reads no lease and refuses the seat past the licensed count", async () => {
      connectEnabled.current = false;

      const plan = await planWith(
        leaseFor({ seatOverageAllowance: ALLOWANCE }),
      );

      expect(plan.maxMembers).toBe(LICENSED_SEATS);
      expect(plan.licensedMembers).toBeUndefined();
      await expect(
        inviteAnotherFullMember({ plan, inUse: LICENSED_SEATS }),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });
  });
});

describe("given the credential the install presents", () => {
  describe("when the instance id is resolved", () => {
    /** @scenario "The instance id on sync is the one the gateway sees" */
    it("is the minted identity, carrying no organization name or id", () => {
      const credential = credentialOf(LICENSE.licenseKey);

      expect(credential.instanceId).toBe(INSTANCE_ID);
      expect(credential.instanceId).not.toContain("ACME");
      expect(credential.instanceId).not.toContain(ORGANIZATION_ID);
    });
  });
});
