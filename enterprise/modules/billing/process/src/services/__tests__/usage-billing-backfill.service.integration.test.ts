// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage-billing catch-up step's backfill, through billing's own lifecycle pipeline: what billing records
 * for peers such as the Instant Evals judge (ADR-174 decision 17). The judge's fold of those
 * facts is bound in the judge's suite.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it } from "vitest";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { UsageBillingBackfillService } from "../usage-billing-backfill.service.ts";

const BILLED = "org-billed";
const NOT_BILLED = "org-not-billed";

function billedLookup(organizationId: string): BillingReportOrganizationLookup {
  return {
    outcome: "usage_billed",
    organization: {
      id: organizationId,
      stripeCustomerId: `cus_${organizationId}`,
      subscriptions: [{ id: `sub_${organizationId}` }],
      contract: "cloud",
    },
  };
}

/** Billing's announcer over its lifecycle pipeline, recording sends, with a clock the test moves. */
function billingAnnouncer({ billed }: { billed: Set<string> }) {
  let nowMs = Date.UTC(2026, 9, 7, 9);
  const announcer = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => null },
    organizations: { findActiveMemberIds: async () => [] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: {
      getOrganizationForBilling: async (organizationId) =>
        billed.has(organizationId) ? billedLookup(organizationId) : { outcome: "not_usage_billed" },
    },
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });
  const recorded: { organizationId: string; usageBilled: boolean; fromCatchUp: boolean }[] = [];
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const { commands } = eventing.register(announcer.pipeline);
  announcer.connect({
    ...commands,
    recordUsageBillingChanged: {
      ...commands.recordUsageBillingChanged,
      send: async (payload) => {
        recorded.push({
          organizationId: payload.organizationId,
          usageBilled: payload.usageBilled,
          fromCatchUp: payload.fromCatchUp,
        });
        await commands.recordUsageBillingChanged.send(payload);
      },
    },
  });
  const backfill = UsageBillingBackfillService.create({
    peers: {
      organizations: { listIds: async () => ({ ids: [BILLED, NOT_BILLED], next: null }) },
      catchUp: (input) => announcer.usageBillingCaughtUp(input),
    },
  });
  const runStep = async () => {
    nowMs += 60_000;
    await backfill.backfill({
      after: undefined,
      dryRun: false,
      signal: new AbortController().signal,
      onPage: async () => {},
    });
  };
  const advance = () => {
    nowMs += 60_000;
  };
  return { announcer, recorded, eventing, runStep, advance };
}

describe("UsageBillingBackfillService", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given an organization the meter bills and one it does not", () => {
    describe("when the usage-billing catch-up runs twice", () => {
      /** @scenario "The usage-billing catch-up gives every organization's answer" */
      it("reads the first as usage billed and the second as not, one row each", async () => {
        const { recorded, eventing, runStep } = billingAnnouncer({ billed: new Set([BILLED]) });
        close = () => eventing.close();

        await runStep();
        await runStep();

        const latest = Object.fromEntries(
          recorded.map(({ organizationId, usageBilled }) => [organizationId, usageBilled]),
        );
        expect(latest).toEqual({ [BILLED]: true, [NOT_BILLED]: false });
        expect(recorded).toHaveLength(4);
        expect(recorded.every((fact) => fact.fromCatchUp)).toBe(true);
      });
    });
  });

  describe("given billing recorded an organization as usage billed from its real fact", () => {
    describe("when billing stopped billing it while the judge's subscriber was not running", () => {
      /** @scenario "A re-run usage-billing catch-up fixes a change the judge missed" */
      it("records it as not usage billed once the catch-up runs again", async () => {
        const billed = new Set([BILLED]);
        const { announcer, recorded, eventing, runStep, advance } = billingAnnouncer({ billed });
        close = () => eventing.close();
        advance();
        await announcer.usageBillingChanged({ organizationId: BILLED });
        expect(recorded.at(-1)).toMatchObject({ usageBilled: true, fromCatchUp: false });

        billed.delete(BILLED);
        advance();
        await runStep();

        expect(recorded.filter((fact) => fact.organizationId === BILLED).at(-1)).toMatchObject({
          usageBilled: false,
          fromCatchUp: true,
        });
      });
    });
  });
});
