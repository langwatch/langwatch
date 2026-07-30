/**
 * Unit tests for the billing meter poke — the cheap per-event trigger that
 * replaced the billingMeterDispatch map reactor.
 *
 * Boundaries mocked: organization resolution and the command port.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "Usage Reporting — Per-Event Poke"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AggregateType } from "../../../../domain/aggregateType";
import { createTenantId } from "../../../../domain/tenantId";
import type { Event } from "../../../../domain/types";
import { generateKillSwitchKey } from "../../../../utils/killSwitch";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../trace-processing/schemas/constants";
import {
  billingMeterPokeDedupId,
  createBillingMeterPokeSubscriber,
} from "../billingMeterPoke.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
}));

const MID_MONTH = Date.UTC(2026, 1, 15, 12, 0, 0); // 15 Feb 2026
const FIRST_OF_MONTH = Date.UTC(2026, 2, 1, 12, 0, 0); // 1 Mar 2026
const THIRD_OF_MONTH = Date.UTC(2026, 2, 3, 12, 0, 0); // 3 Mar 2026
const FOURTH_OF_MONTH = Date.UTC(2026, 2, 4, 12, 0, 0); // 4 Mar 2026

function makeEvent(projectId: string): Event {
  return {
    id: `evt-${projectId}`,
    aggregateId: `trace-${projectId}`,
    aggregateType: "trace",
    tenantId: createTenantId(projectId),
    createdAt: MID_MONTH,
    occurredAt: MID_MONTH,
    version: "2026-02-17",
    type: SPAN_RECEIVED_EVENT_TYPE,
    data: {},
  };
}

function makeSubscriber(
  overrides: {
    reportUsageForMonth?: ReturnType<typeof vi.fn>;
    resolveOrganizationId?: ReturnType<typeof vi.fn>;
    isSaas?: boolean;
    now?: () => number;
  } = {},
) {
  const reportUsageForMonth =
    overrides.reportUsageForMonth ?? vi.fn().mockResolvedValue(undefined);
  const resolveOrganizationId =
    overrides.resolveOrganizationId ?? vi.fn().mockResolvedValue("org-1");

  const subscriber = createBillingMeterPokeSubscriber({
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    reportUsageForMonth,
    isSaas: overrides.isSaas ?? true,
    resolveOrganizationId,
    now: overrides.now ?? (() => MID_MONTH),
  });

  return { subscriber, reportUsageForMonth, resolveOrganizationId };
}

const context = { tenantId: "proj-1", aggregateId: "trace-proj-1" };

describe("billingMeterPoke subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a billable event mid-month", () => {
    /** @scenario "A billable event pokes the usage report for the current month" */
    it("resolves the organization and dispatches for the current month only", async () => {
      const { subscriber, reportUsageForMonth, resolveOrganizationId } =
        makeSubscriber();

      await subscriber.handle(makeEvent("proj-1"), context);

      expect(resolveOrganizationId).toHaveBeenCalledWith("proj-1");
      expect(reportUsageForMonth).toHaveBeenCalledTimes(1);
      expect(reportUsageForMonth).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: MID_MONTH,
      });
    });
  });

  describe("given many events from one project", () => {
    /** @scenario "Rapid billable events collapse onto one usage report" */
    it("keys every one onto the same project-scoped dedup id", () => {
      const first = billingMeterPokeDedupId(makeEvent("proj-1"));
      const second = billingMeterPokeDedupId(makeEvent("proj-1"));
      const other = billingMeterPokeDedupId(makeEvent("proj-2"));

      expect(first).toBe(second);
      expect(first).not.toBe(other);
    });

    /** @scenario "Rapid billable events collapse onto one usage report" */
    it("holds that key for the debounce window", () => {
      const { subscriber } = makeSubscriber();
      const deduplication = subscriber.options?.deduplication;

      // Not "aggregate" — that would collapse per trace, not per project.
      expect(typeof deduplication).toBe("object");
      expect((deduplication as { ttlMs?: number }).ttlMs).toBe(300_000);
      expect(
        (deduplication as { makeId: (e: Event) => string }).makeId(
          makeEvent("proj-1"),
        ),
      ).toBe("billing_dispatch_proj-1");
    });
  });

  describe("given an orphan project", () => {
    it("skips the dispatch instead of failing the job", async () => {
      const { subscriber, reportUsageForMonth } = makeSubscriber({
        resolveOrganizationId: vi.fn().mockResolvedValue(null),
      });

      await expect(
        subscriber.handle(makeEvent("orphan"), context),
      ).resolves.toBeUndefined();
      expect(reportUsageForMonth).not.toHaveBeenCalled();
    });
  });

  describe("given the dispatch fails", () => {
    /** @scenario "A dispatch that fails is raised, not swallowed" */
    it("raises so the job retries and the failure is counted", async () => {
      const { subscriber, reportUsageForMonth } = makeSubscriber({
        reportUsageForMonth: vi
          .fn()
          .mockRejectedValue(new Error("command dispatch failed")),
      });

      await expect(
        subscriber.handle(makeEvent("proj-1"), context),
      ).rejects.toThrow("command dispatch failed");
      expect(reportUsageForMonth).toHaveBeenCalledTimes(1);
    });

    it("still pokes the current month when the previous month fails", async () => {
      const reportUsageForMonth = vi
        .fn()
        .mockRejectedValueOnce(new Error("previous month dispatch failed"))
        .mockResolvedValue(undefined);
      const { subscriber } = makeSubscriber({
        reportUsageForMonth,
        now: () => FIRST_OF_MONTH,
      });

      await expect(
        subscriber.handle(makeEvent("proj-1"), context),
      ).rejects.toThrow("previous month dispatch failed");

      expect(reportUsageForMonth).toHaveBeenCalledTimes(2);
      expect(reportUsageForMonth).toHaveBeenCalledWith(
        expect.objectContaining({ billingMonth: "2026-03" }),
      );
    });
  });

  describe("given the grace window", () => {
    /** @scenario "Late events inside the grace window still reach the previous month" */
    it.each([
      ["first day", FIRST_OF_MONTH, 2],
      ["third day", THIRD_OF_MONTH, 2],
      ["fourth day", FOURTH_OF_MONTH, 1],
    ])("pokes %s correctly", async (_label, at, expected) => {
      const { subscriber, reportUsageForMonth } = makeSubscriber({
        now: () => at as number,
      });

      await subscriber.handle(makeEvent("proj-1"), context);

      expect(reportUsageForMonth).toHaveBeenCalledTimes(expected as number);
      expect(reportUsageForMonth).toHaveBeenCalledWith(
        expect.objectContaining({ billingMonth: "2026-03" }),
      );
    });

    it("dispatches the previous month before the current one", async () => {
      const { subscriber, reportUsageForMonth } = makeSubscriber({
        now: () => FIRST_OF_MONTH,
      });

      await subscriber.handle(makeEvent("proj-1"), context);

      expect(reportUsageForMonth.mock.calls[0]?.[0]).toMatchObject({
        billingMonth: "2026-02",
      });
      expect(reportUsageForMonth.mock.calls[1]?.[0]).toMatchObject({
        billingMonth: "2026-03",
      });
    });
  });

  describe("given a non-SaaS build", () => {
    /** @scenario "Self-hosted builds never poke the usage meter" */
    it("stages no job at all", () => {
      const { subscriber } = makeSubscriber({ isSaas: false });

      expect(subscriber.options?.disabled).toBe(true);
    });
  });

  describe("given the poke is mounted on all four billable pipelines", () => {
    /**
     * The four aggregate types the poke is mounted under. Their derived kill
     * switches differ, which is the whole problem: an operator stopping the
     * billing poke during an incident would have to find and flip four flags,
     * and stopping three of four leaves the billing path running.
     */
    const MOUNTED_AGGREGATE_TYPES = [
      "trace",
      "evaluation",
      "experiment_run",
      "simulation_run",
    ] as const satisfies readonly AggregateType[];

    /** @scenario "One kill switch stops the poke everywhere it is mounted" */
    it("resolves to one switch across mounts whose derived switches differ", () => {
      const { subscriber } = makeSubscriber();

      // The resolution the router and the /ops descriptor list both apply.
      const effectiveKey = (aggregateType: AggregateType) =>
        subscriber.options?.killSwitch?.customKey ??
        generateKillSwitchKey(aggregateType, "subscriber", subscriber.name);

      const derived = MOUNTED_AGGREGATE_TYPES.map((aggregateType) =>
        generateKillSwitchKey(aggregateType, "subscriber", subscriber.name),
      );
      expect(new Set(derived).size).toBe(MOUNTED_AGGREGATE_TYPES.length);

      const effective = MOUNTED_AGGREGATE_TYPES.map(effectiveKey);
      expect(new Set(effective).size).toBe(1);
    });
  });
});
