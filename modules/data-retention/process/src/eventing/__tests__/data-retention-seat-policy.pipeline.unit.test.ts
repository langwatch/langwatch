/**
 * @vitest-environment node
 * Data-retention stamps a paid Growth Seat organization's policies from billing's activation fact
 * (round 37 D4; record §9).
 * @see specs/billing/seat-subscription-retention-policy.feature
 */
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  type RetentionCategory,
  retentionCategories,
  type RetentionPolicy,
} from "@langwatch/data-retention-contract";
import {
  BILLING_LIFECYCLE_EVENT_VERSION,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  type SubscriptionStartedEventData,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { SeatRetentionPolicyService } from "../../services/seat-retention-policy.service.ts";
import { buildDataRetentionSeatPolicyPipeline } from "../data-retention-seat-policy.pipeline.ts";

/** Billing's lifecycle pipeline as its contract names the started fact. */
function billingStandIn() {
  return definePipeline({
    name: "billing_stand_in",
    aggregate: defineAggregate({ type: "billing_lifecycle" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(SUBSCRIPTION_STARTED_EVENT_TYPE),
        data: subscriptionStartedEventDataSchema,
      }),
    ])
    .build();
}

type PolicyWrite = { organizationId: string; category: RetentionCategory; retentionDays: number };

/** Organization policies in memory; `failNextWrite` refuses one write, as a store outage would. */
function policyRules(existing: PolicyWrite[] = []) {
  const written: PolicyWrite[] = [];
  const state = { failNextWrite: false };
  const asPolicy = (row: PolicyWrite, index: number): RetentionPolicy => ({
    id: `policy-${index}`,
    organizationId: row.organizationId,
    scopeType: "ORGANIZATION",
    scopeId: row.organizationId,
    category: row.category,
    retentionDays: row.retentionDays,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const rules = {
    listOrganizationRules: async ({ organizationId }: { organizationId: string }) =>
      [...existing, ...written]
        .filter((row) => row.organizationId === organizationId)
        .map(asPolicy),
    setForScope: async (input: {
      scope: { scopeType: string; scopeId: string };
      category: RetentionCategory;
      retentionDays: number;
    }) => {
      if (state.failNextWrite) {
        state.failNextWrite = false;
        throw new Error("retention store down");
      }
      const row = {
        organizationId: input.scope.scopeId,
        category: input.category,
        retentionDays: input.retentionDays,
      };
      written.push(row);
      return asPolicy(row, written.length);
    },
  };
  return { rules, written, state };
}

function harness(existing: PolicyWrite[] = []) {
  const { rules, written, state } = policyRules(existing);
  const seatPolicies = SeatRetentionPolicyService.create({ rules });
  const provisionMissing = vi.fn((input: { organizationId: string }) =>
    seatPolicies.provisionMissing(input),
  );
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const billing = eventing.register(billingStandIn());
  eventing.register(buildDataRetentionSeatPolicyPipeline({ seatPolicies: { provisionMissing } }));
  const started = (fact: SubscriptionStartedEventData, id: string) =>
    billing.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.organizationId,
          aggregateType: "billing_lifecycle",
          tenantId: createTenantId(fact.tenantId),
          type: SUBSCRIPTION_STARTED_EVENT_TYPE,
          version: BILLING_LIFECYCLE_EVENT_VERSION,
          createdAt: fact.occurredAt,
          occurredAt: fact.occurredAt,
          idempotencyKey: `${fact.organizationId}:${fact.subscriptionId}:${id}`,
          data: fact,
        },
      ],
      { tenantId: createTenantId(fact.tenantId) },
    );
  return { started, written, state, provisionMissing };
}

const activation = (organizationId: string, plan: string): SubscriptionStartedEventData => ({
  tenantId: organizationId,
  occurredAt: 1_790_000_000_000,
  organizationId,
  subscriptionId: `sub-${organizationId}`,
  plan,
  memberUserIds: ["user-1"],
});

const everyCategoryAtTheDefault = (organizationId: string) =>
  retentionCategories.map((category) => ({
    organizationId,
    category,
    retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  }));

describe("given billing records a paid Growth Seat subscription as started", () => {
  describe("when data-retention's subscriber receives the fact", () => {
    /** @scenario A first paid Growth Seat activation provisions the organization policies */
    it("sets an organization policy at the platform default for every category", async () => {
      const { started, written } = harness();

      await started(activation("org-acme", "GROWTH_SEAT_EUR_MONTHLY"), "event-1");

      await vi.waitFor(() => expect(written).toHaveLength(retentionCategories.length));
      expect(written).toEqual(everyCategoryAtTheDefault("org-acme"));
    });

    /** @scenario A billing event never overwrites an existing retention policy */
    it("fills only the categories that have no organization policy", async () => {
      const { started, written, provisionMissing } = harness([
        { organizationId: "org-acme", category: "traces", retentionDays: 400 },
      ]);

      await started(activation("org-acme", "GROWTH_SEAT_EUR_MONTHLY"), "event-1");

      await vi.waitFor(() => expect(provisionMissing).toHaveBeenCalledTimes(1));
      await Promise.all(provisionMissing.mock.results.map((result) => result.value));
      expect(written).toEqual(
        everyCategoryAtTheDefault("org-acme").filter((row) => row.category !== "traces"),
      );
    });

    /** @scenario A retention failure never fails the billing webhook */
    it("leaves billing's record standing when a write fails, and a redelivery fills the gap", async () => {
      const { started, written, state, provisionMissing } = harness();
      state.failNextWrite = true;

      await expect(
        started(activation("org-acme", "GROWTH_SEAT_EUR_MONTHLY"), "event-1"),
      ).resolves.not.toThrow();
      await vi.waitFor(() => expect(provisionMissing).toHaveBeenCalled());
      await started(activation("org-acme", "GROWTH_SEAT_EUR_MONTHLY"), "event-redelivered");

      await vi.waitFor(() =>
        expect(written).toEqual(expect.arrayContaining(everyCategoryAtTheDefault("org-acme"))),
      );
      expect(written).toHaveLength(retentionCategories.length);
    });
  });
});

describe("given billing records a non-seat paid subscription as started", () => {
  describe("when data-retention's subscriber sees the fact", () => {
    /** @scenario A non-seat plan does not provision a policy */
    it("provisions nothing for that organization", async () => {
      const { started, written } = harness();

      await started(activation("org-launch", "LAUNCH"), "event-launch");
      await started(activation("org-seat", "GROWTH_SEAT_EUR_MONTHLY"), "event-seat");

      await vi.waitFor(() => expect(written).toHaveLength(retentionCategories.length));
      expect(written.every((row) => row.organizationId === "org-seat")).toBe(true);
    });
  });
});
