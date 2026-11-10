// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * billing_lifecycle installs the tiered-plan retirement: the superseded-plans fact reaches the
 * process manager, and its intent runs the retirement it was built with.
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { SUPERSEDED_PLANS_FOUND_EVENT_TYPE } from "@langwatch/enterprise-billing-contract";
import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { buildBillingLifecyclePipeline } from "../billing-lifecycle.pipeline.ts";
import {
  type RetireTieredPlansIntent,
  TIERED_PLAN_RETIREMENT_INITIAL_STATE,
  TIERED_PLAN_RETIREMENT_PROCESS_NAME,
} from "../tiered-plan-retirement.process.ts";

const FACT = {
  tenantId: "org_upgrading",
  occurredAt: 1_760_000_000_000,
  organizationId: "org_upgrading",
  seatStripeSubscriptionId: "sub_growth",
};

function built() {
  const retirements: RetireTieredPlansIntent[] = [];
  const definition = buildBillingLifecyclePipeline({
    alerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    retireTieredPlans: async (input) => {
      retirements.push(input);
    },
  });
  const process = definition.processManagers.get(TIERED_PLAN_RETIREMENT_PROCESS_NAME);
  if (!process) throw new Error("billing_lifecycle built no tiered-plan retirement");
  return { process, retirements };
}

describe("given the billing_lifecycle pipeline", () => {
  describe("when a superseded-plans fact is handled and its intent runs", () => {
    /** @scenario "Each superseded-plans fact asks for one retirement" */
    it("runs the retirement it was built with for that fact", async () => {
      const { process, retirements } = built();
      const handler = process.config.handlers[SUPERSEDED_PLANS_FOUND_EVENT_TYPE];
      if (!handler)
        throw new Error("the process manager does not handle the superseded-plans fact");

      const outcome = handler(TIERED_PLAN_RETIREMENT_INITIAL_STATE, FACT, {
        at: FACT.occurredAt,
        now: FACT.occurredAt,
        key: FACT.organizationId,
        projectId: FACT.tenantId,
        intent: intentAccessorOf({
          retireTieredPlans: (messageKey: string, payload: JsonValue) => ({
            messageKey,
            intentType: "retireTieredPlans",
            payload,
          }),
        }),
      });
      const [intent] = outcome.intents ?? [];
      if (!intent) throw new Error("the fact asked for no retirement");
      const run = process.config.intents.retireTieredPlans?.run;
      if (!run) throw new Error("the process manager declares no retireTieredPlans intent");
      await run(intent.payload, {
        processName: TIERED_PLAN_RETIREMENT_PROCESS_NAME,
        projectId: FACT.tenantId,
        processKey: FACT.organizationId,
        tenantId: FACT.tenantId,
        messageKey: intent.messageKey,
        attempt: 1,
      });

      expect(process.config.eventTypes).toContain(SUPERSEDED_PLANS_FOUND_EVENT_TYPE);
      expect(process.config.outbox?.maxAttempts).toBeGreaterThan(1);
      expect(retirements).toEqual([
        expect.objectContaining({
          organizationId: FACT.organizationId,
          seatStripeSubscriptionId: FACT.seatStripeSubscriptionId,
        }),
      ]);
    });
  });
});
