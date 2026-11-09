import type { AuthApi } from "@langwatch/auth-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi, OrganizationSeatOccupants } from "@langwatch/organization-contract";
import type { TenantSource } from "@langwatch/system-migrations";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemorySeatSharingCheckRepository } from "../../repositories/memory/memory.seat-sharing-check.repository.ts";
import { seatSharingWindowStart } from "../../rules/seat-sharing.rules.ts";
import { SeatSharingCheckService } from "../seat-sharing-check.service.ts";

const NOW = Date.UTC(2026, 10, 6, 12);
const SINCE = seatSharingWindowStart(NOW);

/** The organizations a pass walks, in id order, as the Postgres tenant source pages them. */
class ListedOrganizations implements TenantSource {
  constructor(private readonly ids: readonly string[]) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const sorted = this.ids.toSorted();
    return sorted.filter((id) => cursor === null || id > cursor).slice(0, limit);
  }
}

function plan({ free = false, maxMembers }: { free?: boolean; maxMembers: number }): Plan {
  return {
    planSource: free ? "free" : "subscription",
    type: free ? "FREE" : "GROWTH",
    name: free ? "Free" : "Growth",
    free,
    maxMembers,
    maxMembersLite: 0,
    maxMessagesPerMonth: 0,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

function people(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

interface OrganizationFixture {
  plan: Plan | Error;
  occupants?: OrganizationSeatOccupants;
}

function harness({
  organizations,
  sessionUsers = [],
  signedIn = [],
}: {
  organizations: Record<string, OrganizationFixture>;
  sessionUsers?: readonly string[];
  signedIn?: readonly string[];
}) {
  const checks = MemorySeatSharingCheckRepository.create({ store: MemoryOpsStore.create() });
  const { logger, lines } = createTestLogger();
  const askedSince: number[] = [];
  const service = SeatSharingCheckService.create({
    organizationIds: new ListedOrganizations(Object.keys(organizations)),
    peers: {
      plans: createApiFixture<EntitlementApi>({
        getActivePlan: async ({ organizationId }) => {
          const fixture = organizations[organizationId]?.plan;
          if (!fixture || fixture instanceof Error) throw fixture ?? new Error("unknown");
          return fixture;
        },
      }),
      organizations: createApiFixture<OrganizationApi>({
        findSeatOccupantsSince: async ({ organizationId, since }) => {
          askedSince.push(since);
          return (
            organizations[organizationId]?.occupants ?? { fullSeatHolderIds: [], departedIds: [] }
          );
        },
      }),
      sessions: createApiFixture<AuthApi>({
        findSessionUsersSince: async ({ userIds }) =>
          userIds.filter((id) => sessionUsers.includes(id)),
      }),
      users: createApiFixture<UserApi>({
        findSignedInSince: async ({ userIds }) => userIds.filter((id) => signedIn.includes(id)),
      }),
    },
    checks,
    now: () => NOW,
    logger,
  });
  return { service, checks, lines, askedSince };
}

describe("SeatSharingCheckService", () => {
  describe("given ACME on 5 seats with 12 active people in the window", () => {
    /** @scenario "An organization with more than twice its seats in active people is flagged" */
    it("reads 12 people on 5 seats and flags ACME", async () => {
      const holders = people("acme-", 12);
      const { service, checks } = harness({
        organizations: {
          "org-acme": {
            plan: plan({ maxMembers: 5 }),
            occupants: { fullSeatHolderIds: holders.slice(0, 5), departedIds: holders.slice(5) },
          },
        },
        signedIn: holders,
      });

      const check = await service.run();

      expect(check.readings).toEqual([
        {
          organizationId: "org-acme",
          planName: "Growth",
          seats: 5,
          activePeople: 12,
          flagged: true,
        },
      ]);
      expect(check.checkedAt).toBe(NOW);
      expect(check.windowDays).toBe(30);
      await expect(checks.find()).resolves.toEqual([check]);
    });
  });

  describe("given 6 active people on 3 seats", () => {
    /** @scenario "Exactly twice its seats is not flagged" */
    it("does not flag the organization", async () => {
      const holders = people("p", 6);
      const { service } = harness({
        organizations: {
          "org-even": {
            plan: plan({ maxMembers: 3 }),
            occupants: { fullSeatHolderIds: holders.slice(0, 3), departedIds: holders.slice(3) },
          },
        },
        sessionUsers: holders,
      });

      const [reading] = (await service.run()).readings;

      expect(reading).toMatchObject({ activePeople: 6, seats: 3, flagged: false });
    });
  });

  describe("given full-seat members today and people who left in the window", () => {
    /** @scenario "People removed or disabled in the window count beside today's full-seat members" */
    it("counts each person who held a seat in the window once, over the 30 day window", async () => {
      const { service, askedSince } = harness({
        organizations: {
          "org-turnover": {
            plan: plan({ maxMembers: 2 }),
            // u2 left and came back: today's member and a departure, still one person.
            occupants: { fullSeatHolderIds: ["u1", "u2"], departedIds: ["u2", "u3", "u4", "u5"] },
          },
        },
        signedIn: ["u1", "u2", "u3", "u4", "u5"],
      });

      const [reading] = (await service.run()).readings;

      expect(reading?.activePeople).toBe(5);
      // Who left 40 days ago is organization's to leave out: it is asked from 30 days back.
      expect(askedSince).toEqual([SINCE]);
      expect(NOW - SINCE).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe("given four seat holders with different activity", () => {
    /** @scenario "Only people who signed in or used a session in the window count" */
    it("counts the ones who signed in or used a session", async () => {
      const { service } = harness({
        organizations: {
          "org-mixed": {
            plan: plan({ maxMembers: 10 }),
            occupants: {
              fullSeatHolderIds: ["signed-in", "session", "both", "idle"],
              departedIds: [],
            },
          },
        },
        signedIn: ["signed-in", "both"],
        sessionUsers: ["session", "both"],
      });

      const [reading] = (await service.run()).readings;

      expect(reading?.activePeople).toBe(3);
    });
  });

  describe("given an organization on the free plan", () => {
    /** @scenario "Free organizations are not checked" */
    it("holds no reading for it", async () => {
      const { service } = harness({
        organizations: { "org-free": { plan: plan({ free: true, maxMembers: 2 }) } },
      });

      const check = await service.run();

      expect(check.readings).toEqual([]);
    });
  });

  describe("given a paid organization whose plan has uncapped seats", () => {
    /** @scenario "A paid plan with uncapped seats is not checked" */
    it("holds no reading for it", async () => {
      const { service } = harness({
        organizations: {
          "org-uncapped": {
            plan: plan({ maxMembers: Number.MAX_SAFE_INTEGER }),
            occupants: { fullSeatHolderIds: ["a"], departedIds: [] },
          },
        },
        signedIn: ["a"],
      });

      const check = await service.run();

      expect(check.readings).toEqual([]);
    });
  });

  describe("given one of two paid organizations cannot be read", () => {
    /** @scenario "An organization the check cannot read is skipped and the rest are kept" */
    it("keeps the other one and logs the failure with the organization id", async () => {
      const { service, lines } = harness({
        organizations: {
          "org-broken": { plan: new Error("subscription read failed") },
          "org-fine": {
            plan: plan({ maxMembers: 5 }),
            occupants: { fullSeatHolderIds: ["a"], departedIds: [] },
          },
        },
        signedIn: ["a"],
      });

      const check = await service.run();

      expect(check.readings.map((reading) => reading.organizationId)).toEqual(["org-fine"]);
      const warning = lines.findLine("warn", "seat sharing check skipped");
      expect(warning?.organizationId).toBe("org-broken");
    });
  });

  describe("given no check has run yet", () => {
    /** @scenario "Reading the check before it ever ran answers none" */
    it("answers none", async () => {
      const { service } = harness({ organizations: {} });

      await expect(service.findLast()).resolves.toEqual([]);
    });
  });
});
