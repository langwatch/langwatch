// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage-billing catch-up task, through billing's own lifecycle pipeline: what billing records
 * for peers such as the Instant Evals judge (ADR-174 decision 17). The judge's fold of those
 * facts is bound in the judge's suite.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
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

/** Billing's announcer over its lifecycle pipeline, recording sends, with a clock the test moves. */
function billingAnnouncer({ billed }: { billed: Set<string> }) {
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
  const logger = { info: vi.fn() };
  const task = UsageBillingCatchUpTask.create({
    organizations: { findAllIds: async () => [BILLED, NOT_BILLED] },
    billing: { catchUpUsageBilling: (input) => announcer.usageBillingCaughtUp(input) },
    logger,
  });
  const runTask = async ({ args = [] }: { args?: string[] } = {}) => {
    nowMs += 60_000;
    await task.run({ args, signal: new AbortController().signal });
  };
  const advance = () => {
    nowMs += 60_000;
  };
  return { announcer, recorded, eventing, runTask, advance, logger };
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
        const { recorded, eventing, runTask } = billingAnnouncer({ billed: new Set([BILLED]) });
        close = () => eventing.close();

        await runTask();
        await runTask();

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
        const { announcer, recorded, eventing, runTask, advance } = billingAnnouncer({ billed });
        close = () => eventing.close();
        advance();
        await announcer.usageBillingChanged({ organizationId: BILLED });
        expect(recorded.at(-1)).toMatchObject({ usageBilled: true, fromCatchUp: false });

        billed.delete(BILLED);
        advance();
        await runTask();

        expect(recorded.filter((fact) => fact.organizationId === BILLED).at(-1)).toMatchObject({
          usageBilled: false,
          fromCatchUp: true,
        });
      });
    });
  });

  describe("given an organization the meter bills and one it does not", () => {
    describe("when the usage-billing catch-up runs with --dry-run", () => {
      it("records nothing and logs how many organizations it would mark each way", async () => {
        const { recorded, eventing, runTask, logger } = billingAnnouncer({
          billed: new Set([BILLED]),
        });
        close = () => eventing.close();

        await runTask({ args: ["--dry-run"] });

        expect(logger.info).toHaveBeenCalledWith(
          { isDryRun: true, organizations: 2, usageBilled: 1, notUsageBilled: 1 },
          expect.any(String),
        );
        expect(recorded).toEqual([]);
      });
    });

    describe("when it runs for real", () => {
      it("logs the same counts it recorded", async () => {
        const { eventing, runTask, logger } = billingAnnouncer({ billed: new Set([BILLED]) });
        close = () => eventing.close();

        await runTask();

        expect(logger.info).toHaveBeenCalledWith(
          { isDryRun: false, organizations: 2, usageBilled: 1, notUsageBilled: 1 },
          expect.any(String),
        );
      });
    });
  });
});
