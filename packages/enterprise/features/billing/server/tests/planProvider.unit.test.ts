import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { getFreePlanLimits, PLAN_LIMITS } from "@langwatch/enterprise-billing-contract";
import { NUMERIC_OVERRIDE_FIELDS, SaaSPlanProviderService } from "../src/index";
import { PrismaSubscriptionRepository } from "../src/repositories/prisma/prisma.subscription.repository";
import { PlanTypes, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";

const mockEnv: {
  IS_SAAS: boolean | undefined;
  ADMIN_EMAILS: string | undefined;
} = { IS_SAAS: false, ADMIN_EMAILS: undefined };

const createSaaSPlanProvider = (db: PrismaClient): SaaSPlanProviderService =>
  SaaSPlanProviderService.create({
    subscriptions: PrismaSubscriptionRepository.create(db),
    isSaas: mockEnv.IS_SAAS ?? false,
    adminEmails: mockEnv.ADMIN_EMAILS,
  });

const createMockDb = ({
  findFirstResult = null,
  orgFindUniqueResult = undefined,
}: {
  findFirstResult?: unknown;
  orgFindUniqueResult?: unknown;
} = {}) => {
  return {
    subscription: {
      findFirst: vi.fn().mockResolvedValue(findFirstResult),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgFindUniqueResult),
    },
  } as unknown as PrismaClient;
};

/**
 * A `findFirst` that honors the `orderBy` it is handed, reading the clauses the
 * way Prisma does: the first decides, later ones break ties.
 *
 * A canned single row cannot tell whether the query orders anything, so the
 * only assertion left would be a copy of the query's own literal, which passes
 * even if the database ignores it. Sorting here lets the test say which row is
 * selected.
 */
type OrderableRow = { id: string; createdAt: Date };
type OrderByClause = Record<string, "asc" | "desc">;

const compareByClause = (
  a: OrderableRow,
  b: OrderableRow,
  clause: OrderByClause,
): number => {
  const [field, direction] = Object.entries(clause)[0] as [
    "id" | "createdAt",
    "asc" | "desc",
  ];
  const left = a[field];
  const right = b[field];
  const ascending = left < right ? -1 : left > right ? 1 : 0;
  return direction === "desc" ? -ascending : ascending;
};

const firstUnder = <T extends OrderableRow>(
  rows: T[],
  orderBy: OrderByClause[],
): T | null => {
  const ordered = [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const settled = compareByClause(a, b, clause);
      if (settled !== 0) return settled;
    }
    return 0;
  });
  return ordered[0] ?? null;
};

const dbHolding = (
  rows: Array<OrderableRow & { plan: string; status: string }>,
): PrismaClient =>
  ({
    subscription: {
      findFirst: vi.fn(async (query?: { orderBy?: OrderByClause[] }) =>
        firstUnder(rows, query?.orderBy ?? []),
      ),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(undefined),
    },
  }) as unknown as PrismaClient;

describe("getFreePlanLimits", () => {
  /** @scenario 'All pricing models get 50,000 events on the free tier' */
  it("returns 50,000 messages per month", () => {
    const plan = getFreePlanLimits();
    expect(plan.maxMessagesPerMonth).toBe(50_000);
  });

  it("preserves all other FREE plan properties", () => {
    const plan = getFreePlanLimits();
    const baseFree = PLAN_LIMITS[PlanTypes.FREE];

    expect(plan.type).toBe(PlanTypes.FREE);
    expect(plan.name).toBe("Free");
    expect(plan.free).toBe(true);
    expect(plan.maxMembers).toBe(baseFree.maxMembers);
    expect(plan.maxMembersLite).toBe(baseFree.maxMembersLite);
  });
});

describe("createSaaSPlanProvider", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = false;
    mockEnv.ADMIN_EMAILS = undefined;
  });

  describe("when IS_SAAS is false", () => {
    // Unreachable through the wiring, since a self-hosted deployment resolves
    // its plan from the license provider. It answers the free baseline anyway:
    // a deployment that reached this line by mistake must not be handed the
    // entitlements the top tier carries.
    it("returns the free baseline rather than a tier nobody bought", async () => {
      mockEnv.IS_SAAS = false;

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1");

      expect(plan.type).toBe(PlanTypes.FREE);
      expect(plan.maxMembers).toBe(PLAN_LIMITS[PlanTypes.FREE].maxMembers);
      expect(plan.webhookEndpointsEnabled).not.toBe(true);
    });
  });

  describe("when IS_SAAS is true", () => {
    beforeEach(() => {
      mockEnv.IS_SAAS = true;
    });

    describe("when no subscription exists", () => {
      it("returns FREE limits", async () => {
        const db = createMockDb();
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.maxMembers).toBe(PLAN_LIMITS[PlanTypes.FREE].maxMembers);
      });

      describe("when organization has SEAT_EVENT pricing model", () => {
        /** @scenario 'SEAT_EVENT organization on FREE plan gets 50,000 events per month' */
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when organization has TIERED pricing model", () => {
        /** @scenario 'TIERED organization on FREE plan gets 50,000 events per month' */
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: { pricingModel: "TIERED" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when organization is not found", () => {
        /** @scenario 'Organization not found gets 50,000 events per month' */
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: null,
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });
    });

    describe("when active subscription exists", () => {
      /** @scenario Only non-null overrides replace plan defaults */
      it("returns plan limits with custom overrides", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMembers: 10,
          maxMembersLite: null,
          maxMessagesPerMonth: null,
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.LAUNCH);
        expect(plan.maxMembers).toBe(10);
        expect(plan.maxMembersLite).toBe(PLAN_LIMITS[PlanTypes.LAUNCH].maxMembersLite);
      });

      describe("when valid subscription exists for SEAT_EVENT org", () => {
        /** @scenario Valid subscription returns its own plan regardless of pricing model */
        it("does not query the organization table", async () => {
          const subscription = {
            plan: PlanTypes.LAUNCH,
            status: SubscriptionStatus.ACTIVE,
            maxMembers: null,
            maxMembersLite: null,
            maxMessagesPerMonth: null,
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.LAUNCH);
          expect(db.organization.findUnique).not.toHaveBeenCalled();
        });
      });
    });

    describe("when customLimits fields are 0", () => {
      it("preserves 0 values instead of ignoring them", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, 0])),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        for (const field of NUMERIC_OVERRIDE_FIELDS) {
          expect(plan[field], `expected ${field} to be 0`).toBe(0);
        }
      });
    });

    describe("when maxMembersLite override is set", () => {
      it("applies the override (bug fix)", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMembersLite: 25,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembersLite").map((f) => [
              f,
              null,
            ]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxMembersLite).toBe(25);
      });
    });

    describe("when new override fields are set", () => {
      it.each([
        ["maxMembersLite", 15],
        ["maxMessagesPerMonth", 200_000],
      ] as const)("applies %s override when set to %d", async (field, value) => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          [field]: value,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== field).map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan[field]).toBe(value);
      });
    });

    describe("when lite-member capacity is overridden", () => {
      /** @scenario Subscription with a lite-member override uses that value */
      it("returns the override value for maxMembersLite", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMembersLite: 50,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembersLite").map((f) => [
              f,
              null,
            ]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxMembersLite).toBe(50);
      });
    });

    describe("when monthly message capacity is overridden", () => {
      /** @scenario Subscription with a monthly message override uses that value */
      it("returns the override value for maxMessagesPerMonth", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMessagesPerMonth: 500_000,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMessagesPerMonth").map(
              (f) => [f, null],
            ),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxMessagesPerMonth).toBe(500_000);
      });
    });

    describe("when several overrides are set together", () => {
      /** @scenario Several overrides are applied together */
      it("applies each override and leaves remaining fields at plan defaults", async () => {
        const overrides = {
          maxMembers: 20,
          maxMembersLite: 30,
          maxMessagesPerMonth: 200_000,
        };
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          ...overrides,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => !(f in overrides)).map((f) => [
              f,
              null,
            ]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxMembers).toBe(20);
        expect(plan.maxMembersLite).toBe(30);
        expect(plan.maxMessagesPerMonth).toBe(200_000);

        const basePlan = PLAN_LIMITS[PlanTypes.LAUNCH];
        for (const field of NUMERIC_OVERRIDE_FIELDS) {
          if (field in overrides) continue;
          expect(plan[field], `expected ${field} to match plan default`).toBe(
            basePlan[field],
          );
        }
      });
    });

    describe("when all overrides are null", () => {
      it("falls back to plan defaults for every field", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        const basePlan = PLAN_LIMITS[PlanTypes.LAUNCH];
        for (const field of NUMERIC_OVERRIDE_FIELDS) {
          expect(plan[field], `expected ${field} to match plan default`).toBe(
            basePlan[field],
          );
        }
      });
    });

    describe("when plan key not in PLAN_LIMITS", () => {
      it("falls back to FREE", async () => {
        const subscription = {
          plan: "NONEXISTENT_PLAN",
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
      });

      /** @scenario 'Custom subscription limits override the base free allowance' */
      it("applies overrides over free defaults", async () => {
        const subscription = {
          plan: "NONEXISTENT_PLAN",
          status: SubscriptionStatus.ACTIVE,
          maxMembersLite: 50,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembersLite").map((f) => [
              f,
              null,
            ]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.maxMembersLite).toBe(50);
      });

      describe("when SEAT_EVENT org has unknown plan key", () => {
        it("returns FREE with 50,000 messages per month", async () => {
          const subscription = {
            plan: "NONEXISTENT_PLAN",
            status: SubscriptionStatus.ACTIVE,
            ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null])),
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when SEAT_EVENT org has unknown plan key with custom limits", () => {
        it("preserves subscription custom limits over free plan limits", async () => {
          const subscription = {
            plan: "NONEXISTENT_PLAN",
            status: SubscriptionStatus.ACTIVE,
            maxMembers: 15,
            ...Object.fromEntries(
              NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembers").map((f) => [
                f,
                null,
              ]),
            ),
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
          expect(plan.maxMembers).toBe(15);
        });
      });
    });

    describe("when subscription is CANCELLED", () => {
      /** @scenario Cancelled subscription resolves to free tier limits */
      it("resolves to free tier limits", async () => {
        // A CANCELLED subscription must not appear in active subscription query.
        // The findFirst query filters by status: ACTIVE, so cancelled subs are excluded.
        // This regression test ensures a cancelled Growth Seat sub doesn't leak 20 maxMembers.
        const db = createMockDb({
          findFirstResult: null, // cancelled sub is not returned by the ACTIVE-only query
        });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.free).toBe(true);
        expect(plan.maxMembers).toBe(2);
        expect(plan.maxMessagesPerMonth).toBe(50_000);

        // Lock in the query filter: only ACTIVE subscriptions are fetched
        expect(db.subscription.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: SubscriptionStatus.ACTIVE,
            }),
          }),
        );
      });
    });
  });

  describe("when impersonator is admin", () => {
    it("sets overrideAddingLimitations to true", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "admin@example.com, other@example.com";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "admin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("trims whitespace in admin email list", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "  admin@example.com , other@example.com  ";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "admin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("does not set overrideAddingLimitations when impersonator is not admin", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "admin@example.com";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "notadmin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(false);
    });
  });
});

describe("createSaaSPlanProvider subscription selection", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = true;
    mockEnv.ADMIN_EMAILS = undefined;
  });

  describe("given an organization holding more than one active subscription", () => {
    type ActiveRow = {
      id: string;
      organizationId: string;
      plan: string;
      status: string;
      createdAt: Date;
    };

    const NEWEST: ActiveRow = {
      id: "sub_a",
      organizationId: "org_1",
      plan: PlanTypes.ENTERPRISE,
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    };
    const OLDER: ActiveRow = {
      id: "sub_z",
      organizationId: "org_1",
      plan: PlanTypes.PRO,
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    };

    const planFrom = async (rows: ActiveRow[]) =>
      (await createSaaSPlanProvider(dbHolding(rows)).getActivePlan("org_1")).type;

    it("reads the newest contract, not whichever row the database lists first", async () => {
      // Handed over oldest-first, which is what a query with no ordering can
      // hand back, so a dropped `orderBy` resolves PRO and fails here.
      expect(await planFrom([OLDER, NEWEST])).toBe(PlanTypes.ENTERPRISE);
    });

    it("reads the same contract whichever order the rows arrive in", async () => {
      expect(await planFrom([NEWEST, OLDER])).toBe(PlanTypes.ENTERPRISE);
    });

    it("settles two contracts created in the same instant on the id", async () => {
      const instant = new Date("2026-02-01T00:00:00.000Z");
      // Highest id wins, so the ENTERPRISE row does, and it is listed second
      // to keep arrival order from being what decides.
      const lower = { ...OLDER, id: "sub_a", createdAt: instant };
      const higher = { ...NEWEST, id: "sub_z", createdAt: instant };

      expect(await planFrom([lower, higher])).toBe(PlanTypes.ENTERPRISE);
    });
  });
});
