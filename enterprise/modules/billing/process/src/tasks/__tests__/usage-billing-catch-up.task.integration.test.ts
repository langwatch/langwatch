// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage-billing catch-up task, through billing's own lifecycle pipeline, into the Instant
 * Evals judge's real fold over memory tables (ADR-174 decision 17).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { instantEvalJudgeOverMemory } from "@langwatch/instant-eval-judge-process/testing";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { BillingLifecycleAnnouncerService } from "../../services/billing-lifecycle-announcer.service.ts";
import { UsageBillingCatchUpTask } from "../usage-billing-catch-up.task.ts";

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

/** Billing's announcer and the judge's folds on one eventing, with a clock the test moves. */
function billingBesideJudge({ billed }: { billed: Set<string> }) {
  let nowMs = Date.UTC(2026, 9, 7, 9);
  const announcer = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => null },
    organizations: { getAllMembers: async () => [] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: {
      getOrganizationForBilling: async (organizationId) =>
        billed.has(organizationId) ? billedLookup(organizationId) : { outcome: "not_usage_billed" },
    },
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });
  const judge = instantEvalJudgeOverMemory();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  announcer.connect(eventing.register(announcer.pipeline).commands);
  eventing.register(judge.factsPipeline());
  const task = UsageBillingCatchUpTask.create({
    organizations: { findAllIds: async () => [BILLED, NOT_BILLED] },
    billing: { catchUpUsageBilling: (input) => announcer.usageBillingCaughtUp(input) },
  });
  const runTask = async () => {
    nowMs += 60_000;
    await task.run({ args: [], signal: new AbortController().signal });
  };
  const advance = () => {
    nowMs += 60_000;
  };
  return { announcer, judge, eventing, runTask, advance };
}

describe("UsageBillingCatchUpTask", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given an organization the meter bills and one it does not", () => {
    describe("when the usage-billing catch-up runs twice", () => {
      /** @scenario "The usage-billing catch-up gives every organization's answer" */
      it("reads the first as usage billed and the second as not, one row each", async () => {
        const { judge, eventing, runTask } = billingBesideJudge({ billed: new Set([BILLED]) });
        close = () => eventing.close();

        await runTask();
        await runTask();

        await vi.waitFor(async () => {
          expect(await judge.usageBilledOf({ organizationId: BILLED })).toBe(true);
          expect(await judge.usageBilledOf({ organizationId: NOT_BILLED })).toBe(false);
          // The second run's facts are newer reads, so they are the ones held.
          expect([...judge.rows.usageBilling.values()].every((fact) => fact.fromCatchUp)).toBe(
            true,
          );
          expect(judge.rows.usageBilling.get(BILLED)?.occurredAtMs).toBe(
            Date.UTC(2026, 9, 7, 9, 2),
          );
        });
        expect(judge.rows.usageBilling.size).toBe(2);
      });
    });
  });

  describe("given the judge reads an organization as usage billed from billing's real fact", () => {
    describe("when billing stopped billing it while the judge's subscriber was not running", () => {
      /** @scenario "A re-run usage-billing catch-up fixes a change the judge missed" */
      it("reads it as not usage billed once the catch-up runs again", async () => {
        const billed = new Set([BILLED]);
        const { announcer, judge, eventing, runTask, advance } = billingBesideJudge({ billed });
        close = () => eventing.close();
        advance();
        await announcer.usageBillingChanged({ organizationId: BILLED });
        await vi.waitFor(async () =>
          expect(await judge.usageBilledOf({ organizationId: BILLED })).toBe(true),
        );

        // Old pods ran without the judge's subscriber: billing changed, the judge heard nothing.
        billed.delete(BILLED);
        advance();
        expect(await judge.usageBilledOf({ organizationId: BILLED })).toBe(true);

        await runTask();

        await vi.waitFor(async () =>
          expect(await judge.usageBilledOf({ organizationId: BILLED })).toBe(false),
        );
      });
    });
  });
});
