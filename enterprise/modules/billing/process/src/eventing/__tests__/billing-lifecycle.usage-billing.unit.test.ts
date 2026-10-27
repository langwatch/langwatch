// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage-billing fact's key (ADR-174 decision 17): a catch-up re-run is a new fact, a real
 * fact is keyed by its answer and stamp.
 */
import { describe, expect, it } from "vitest";

import {
  RecordUsageBillingChangedCommand,
  usageBillingChangedKeyOf,
} from "../billing-lifecycle.commands.ts";

const fact = {
  tenantId: "org-1",
  organizationId: "org-1",
  usageBilled: true,
  occurredAt: 1_700,
};

describe("the usage-billing fact", () => {
  it("keys a catch-up fact by the instant it read billing", () => {
    expect(usageBillingChangedKeyOf({ ...fact, fromCatchUp: true })).toBe(
      "org-1:usage-billed:catch-up:1700",
    );
  });

  it("keys a real fact by its answer and stamp", () => {
    expect(usageBillingChangedKeyOf({ ...fact, fromCatchUp: false })).toBe(
      "org-1:usage-billed:true:1700",
    );
  });

  it("records one event on the organization's aggregate carrying the fact", () => {
    const [event] = new RecordUsageBillingChangedCommand().handle({
      tenantId: "org-1",
      aggregateId: "org-1",
      type: "lw.billing.record_usage_billing_changed",
      data: { ...fact, fromCatchUp: false },
    } as Parameters<RecordUsageBillingChangedCommand["handle"]>[0]);

    expect(event).toMatchObject({
      aggregateId: "org-1",
      type: "lw.billing.usage_billing_changed",
      occurredAt: 1_700,
      idempotencyKey: "org-1:usage-billed:true:1700",
      data: { usageBilled: true, fromCatchUp: false },
    });
  });
});
