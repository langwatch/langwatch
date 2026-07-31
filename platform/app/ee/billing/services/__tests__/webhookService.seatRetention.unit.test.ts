import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The retention policy store is faked with real upsert semantics rather than a
 * bare spy: the hazard this guard exists for is a *value* being overwritten, so
 * the assertions read the stored day count back instead of counting calls. A
 * call-count assertion would still pass if the write landed with the right
 * arguments on the wrong row.
 */
type PolicyRow = {
  scopeType: string;
  scopeId: string;
  category: string;
  retentionDays: number;
};

const { retentionRows, mockSetForScope, mockListOrganizationRules } =
  vi.hoisted(() => {
    const rows = new Map<string, PolicyRow>();
    const key = (row: Pick<PolicyRow, "scopeType" | "scopeId" | "category">) =>
      `${row.scopeType}:${row.scopeId}:${row.category}`;

    return {
      retentionRows: rows,
      mockListOrganizationRules: vi.fn(async (_organizationId: string) =>
        [...rows.values()].map((row) => ({ ...row })),
      ),
      mockSetForScope: vi.fn(
        async ({
          scope,
          category,
          retentionDays,
        }: {
          scope: { scopeType: string; scopeId: string };
          category: string;
          retentionDays: number;
        }) => {
          const row = {
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            category,
            retentionDays,
          };
          rows.set(key(row), row);
          return row;
        },
      ),
    };
  });

const { mockSendSlackSubscriptionEvent, mockFireSubscriptionSyncNurturing } =
  vi.hoisted(() => ({
    mockSendSlackSubscriptionEvent: vi.fn(async () => undefined),
    mockFireSubscriptionSyncNurturing: vi.fn(),
  }));

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    dataRetention: {
      policy: {
        setForScope: mockSetForScope,
        listOrganizationRules: mockListOrganizationRules,
      },
    },
    notifications: {
      sendSlackSubscriptionEvent: mockSendSlackSubscriptionEvent,
    },
  }),
}));

vi.mock("../../nurturing/hooks/subscriptionSync", () => ({
  fireSubscriptionSyncNurturing: mockFireSubscriptionSyncNurturing,
}));

import type Stripe from "stripe";
import type { OrganizationRepository } from "../../../../src/server/app-layer/organizations/repositories/organization.repository";
import type {
  SubscriptionRepository,
  SubscriptionWithOrg,
} from "../../../../src/server/app-layer/subscription/subscription.repository";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_CATEGORIES,
} from "../../../../src/server/data-retention/retentionPolicy.schema";
import { PlanTypes, SubscriptionStatus } from "../../planTypes";
import { EEWebhookService } from "../webhookService";

const ORG_ID = "organization_seat_retention";
const DB_SUBSCRIPTION_ID = "subscription_db_1";
const STRIPE_SUBSCRIPTION_ID = "sub_stripe_1";

/** Five years, the grandfathered window the scenario names. */
const FIVE_YEARS_IN_DAYS = 1827;

/** Matches STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS in the service under test. */
const STRIPE_CONSISTENCY_DELAY_MS = 2000;

const orgPolicyDays = (category: string): number | undefined =>
  retentionRows.get(`ORGANIZATION:${ORG_ID}:${category}`)?.retentionDays;

const seedPolicy = (row: PolicyRow) =>
  retentionRows.set(`${row.scopeType}:${row.scopeId}:${row.category}`, row);

const activatedSubscription = (plan: string): SubscriptionWithOrg =>
  ({
    id: DB_SUBSCRIPTION_ID,
    organizationId: ORG_ID,
    plan,
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    maxMembers: 5,
    maxMessagesPerMonth: 100_000,
    organization: { id: ORG_ID, name: "Acme", license: null },
  }) as unknown as SubscriptionWithOrg;

describe("applySeatRetentionPolicy", () => {
  let subscriptionRepository: {
    findByStripeId: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    migrateToSeatEvent: ReturnType<typeof vi.fn>;
  };
  let organizationRepository: { clearTrialLicense: ReturnType<typeof vi.fn> };
  let stripe: {
    subscriptions: {
      retrieve: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    };
  };
  let service: EEWebhookService;

  const givenPreviousStatus = (status: string) => {
    subscriptionRepository.findByStripeId.mockResolvedValue({
      id: DB_SUBSCRIPTION_ID,
      status,
    });
  };

  const givenActivatedPlan = (plan: string) => {
    subscriptionRepository.activate.mockResolvedValue(
      activatedSubscription(plan),
    );
  };

  /** Drives the real webhook entry point, skipping its consistency delay. */
  const processBillingEvent = async () => {
    const pending = service.handleInvoicePaymentSucceeded({
      subscriptionId: STRIPE_SUBSCRIPTION_ID,
    });
    await vi.advanceTimersByTimeAsync(STRIPE_CONSISTENCY_DELAY_MS);
    return await pending;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    retentionRows.clear();
    vi.useFakeTimers({ toFake: ["setTimeout"] });

    subscriptionRepository = {
      findByStripeId: vi.fn(),
      activate: vi.fn(),
      migrateToSeatEvent: vi.fn().mockResolvedValue([]),
    };
    organizationRepository = { clearTrialLicense: vi.fn() };
    stripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({ status: "active" }),
        cancel: vi.fn(),
      },
    };

    givenPreviousStatus(SubscriptionStatus.PENDING);
    givenActivatedPlan(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);

    service = new EEWebhookService({
      subscriptionRepository:
        subscriptionRepository as unknown as SubscriptionRepository,
      organizationRepository:
        organizationRepository as unknown as OrganizationRepository,
      stripe: stripe as unknown as Stripe,
      itemCalculator: {
        calculateQuantityForPrice: vi.fn(),
        prices: {},
      } as never,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the organization has no organization-level retention policy", () => {
    describe("when a seat billing event is processed", () => {
      it("provisions every category at the platform default", async () => {
        await processBillingEvent();

        for (const category of RETENTION_CATEGORIES) {
          expect(orgPolicyDays(category)).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
        }
        expect(mockSetForScope).toHaveBeenCalledTimes(
          RETENTION_CATEGORIES.length,
        );
      });
    });
  });

  describe("given the organization already has a longer org-level traces policy", () => {
    describe("when a seat billing event is processed", () => {
      /**
       * The data-loss guard. An unconditional write here would shorten a
       * grandfathered 1827-day window to the 49-day platform default, and the
       * TTL reconciler would then delete five years of the customer's traces.
       *
       * @scenario A billing event never overwrites an existing retention policy
       */
      it("leaves the grandfathered retention untouched and provisions only the missing categories", async () => {
        seedPolicy({
          scopeType: "ORGANIZATION",
          scopeId: ORG_ID,
          category: "traces",
          retentionDays: FIVE_YEARS_IN_DAYS,
        });

        await processBillingEvent();

        // The stored value is what matters: still five years, not the default.
        expect(orgPolicyDays("traces")).toBe(FIVE_YEARS_IN_DAYS);
        expect(orgPolicyDays("traces")).not.toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
        expect(mockSetForScope).not.toHaveBeenCalledWith(
          expect.objectContaining({ category: "traces" }),
        );

        // Only the categories that had no policy at all are provisioned.
        expect(orgPolicyDays("scenarios")).toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
        expect(orgPolicyDays("experiments")).toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
        expect(mockSetForScope).toHaveBeenCalledTimes(
          RETENTION_CATEGORIES.length - 1,
        );
      });
    });
  });

  describe("given a project-scoped policy covers a category", () => {
    describe("when a seat billing event is processed", () => {
      it("still provisions the organization-level policy for that category", async () => {
        seedPolicy({
          scopeType: "PROJECT",
          scopeId: "project_1",
          category: "scenarios",
          retentionDays: 63,
        });

        await processBillingEvent();

        expect(orgPolicyDays("scenarios")).toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
        expect(mockSetForScope).toHaveBeenCalledTimes(
          RETENTION_CATEGORIES.length,
        );
      });
    });
  });

  describe("given another organization holds the policy for a category", () => {
    describe("when a seat billing event is processed", () => {
      it("does not treat the other organization's row as coverage", async () => {
        seedPolicy({
          scopeType: "ORGANIZATION",
          scopeId: "organization_other",
          category: "experiments",
          retentionDays: 365,
        });

        await processBillingEvent();

        expect(orgPolicyDays("experiments")).toBe(
          PLATFORM_DEFAULT_RETENTION_DAYS,
        );
        expect(mockSetForScope).toHaveBeenCalledTimes(
          RETENTION_CATEGORIES.length,
        );
      });
    });
  });

  describe("given the retention rules cannot be read", () => {
    describe("when a seat billing event is processed", () => {
      it("writes no policy at all rather than risk clobbering an unseen one", async () => {
        mockListOrganizationRules.mockRejectedValueOnce(
          new Error("retention store down"),
        );

        await expect(processBillingEvent()).resolves.toBeUndefined();

        expect(mockSetForScope).not.toHaveBeenCalled();
      });
    });
  });

  describe("given one category's write fails", () => {
    describe("when a seat billing event is processed", () => {
      it("still provisions the remaining categories and never fails the webhook", async () => {
        mockSetForScope.mockRejectedValueOnce(
          new Error("retention store down"),
        );

        await expect(processBillingEvent()).resolves.toBeUndefined();

        expect(mockSetForScope).toHaveBeenCalledTimes(
          RETENTION_CATEGORIES.length,
        );
        expect(retentionRows.size).toBe(RETENTION_CATEGORIES.length - 1);
      });
    });
  });

  describe("given the subscription is not a Growth-Seat plan", () => {
    describe("when a billing event is processed", () => {
      it("touches no retention policy", async () => {
        givenActivatedPlan(PlanTypes.LAUNCH);

        await processBillingEvent();

        expect(mockListOrganizationRules).not.toHaveBeenCalled();
        expect(mockSetForScope).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the subscription was already active", () => {
    describe("when a repeat billing event is processed", () => {
      it("touches no retention policy", async () => {
        givenPreviousStatus(SubscriptionStatus.ACTIVE);

        await processBillingEvent();

        expect(mockListOrganizationRules).not.toHaveBeenCalled();
        expect(mockSetForScope).not.toHaveBeenCalled();
      });
    });
  });
});
