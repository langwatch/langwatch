// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see enterprise/modules/billing/specs/stripe-webhook.feature */
import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import {
  TIERED_PLAN_RETIREMENT_INITIAL_STATE,
  tieredPlanRetirementSupersededPlansFound,
} from "../tiered-plan-retirement.process.ts";

const FACT = {
  tenantId: "org_upgrading",
  occurredAt: 1_760_000_000_000,
  organizationId: "org_upgrading",
  seatStripeSubscriptionId: "sub_growth",
};

const ctx = {
  at: FACT.occurredAt,
  now: FACT.occurredAt + 1_000,
  key: FACT.organizationId,
  projectId: FACT.tenantId,
  intent: intentAccessorOf({
    retireTieredPlans: (messageKey: string, payload: JsonValue) => ({
      messageKey,
      intentType: "retireTieredPlans",
      payload,
    }),
  }),
};

describe("tieredPlanRetirementSupersededPlansFound", () => {
  /** @scenario "Each superseded-plans fact asks for one retirement" */
  it("asks for one retirement keyed by the fact, the same key on a second handling", () => {
    const first = tieredPlanRetirementSupersededPlansFound(
      TIERED_PLAN_RETIREMENT_INITIAL_STATE,
      FACT,
      ctx,
    );
    const second = tieredPlanRetirementSupersededPlansFound(first.state, FACT, ctx);

    expect(first.intents).toEqual([
      {
        messageKey: "org_upgrading:superseded_plans_found:sub_growth:1760000000000",
        intentType: "retireTieredPlans",
        payload: { organizationId: "org_upgrading", seatStripeSubscriptionId: "sub_growth" },
      },
    ]);
    expect(second.intents).toEqual(first.intents);
    expect(first.state).toEqual({ lastFoundAt: FACT.occurredAt });
  });
});
