/**
 * Unit tests for the billing meter poke.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "A billable event pokes this month's usage report"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderGroupKey } from "@langwatch/event-sourcing";

import {
  type BillableEventForPoke,
  billingMeterPokeDedupId,
  billingMeterPokeGroupKey,
  createBillingMeterPokeMount,
  handleBillableEventPoke,
} from "../billingMeterPoke";

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

function makeEvent(tenantId: string): BillableEventForPoke {
  return { tenantId };
}

function makeDeps(
  overrides: {
    dispatchReport?: ReturnType<typeof vi.fn>;
    resolveOrganizationId?: ReturnType<typeof vi.fn>;
    now?: () => number;
  } = {},
) {
  const dispatchReport = overrides.dispatchReport ?? vi.fn().mockResolvedValue(undefined);
  const resolveOrganizationId = overrides.resolveOrganizationId ?? vi.fn().mockResolvedValue("org-1");
  return {
    dispatchReport,
    resolveOrganizationId,
    now: overrides.now ?? (() => MID_MONTH),
  };
}

describe("handleBillableEventPoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a billable event mid-month", () => {
    /** @scenario "A billable event pokes the usage report for the current month" */
    it("resolves the organization and dispatches for the current month only", async () => {
      const deps = makeDeps();

      await handleBillableEventPoke(makeEvent("proj-1"), deps);

      expect(deps.resolveOrganizationId).toHaveBeenCalledWith("proj-1");
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
      expect(deps.dispatchReport).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: MID_MONTH,
      });
    });
  });

  describe("given an orphan project", () => {
    it("skips the dispatch instead of failing the job", async () => {
      const deps = makeDeps({ resolveOrganizationId: vi.fn().mockResolvedValue(undefined) });

      await expect(handleBillableEventPoke(makeEvent("orphan"), deps)).resolves.toBeUndefined();
      expect(deps.dispatchReport).not.toHaveBeenCalled();
    });
  });

  describe("given the dispatch fails", () => {
    /** @scenario "A dispatch that fails is raised, not swallowed" */
    it("raises so the job retries and the failure is counted", async () => {
      const deps = makeDeps({
        dispatchReport: vi.fn().mockRejectedValue(new Error("command dispatch failed")),
      });

      await expect(handleBillableEventPoke(makeEvent("proj-1"), deps)).rejects.toThrow(
        "command dispatch failed",
      );
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A dispatch that fails is raised, not swallowed" */
    it("still pokes the current month when the previous month's dispatch fails", async () => {
      const dispatchReport = vi
        .fn()
        .mockRejectedValueOnce(new Error("previous month dispatch failed"))
        .mockResolvedValue(undefined);
      const deps = makeDeps({ dispatchReport, now: () => FIRST_OF_MONTH });

      await expect(handleBillableEventPoke(makeEvent("proj-1"), deps)).rejects.toThrow(
        "previous month dispatch failed",
      );

      expect(dispatchReport).toHaveBeenCalledTimes(2);
      expect(dispatchReport).toHaveBeenCalledWith(expect.objectContaining({ billingMonth: "2026-03" }));
    });
  });

  describe("given the grace window", () => {
    /** @scenario "Late events inside the grace window still reach the previous month" */
    it.each([
      ["first day", FIRST_OF_MONTH, 2],
      ["third day", THIRD_OF_MONTH, 2],
      ["fourth day", FOURTH_OF_MONTH, 1],
    ])("pokes %s correctly", async (_label, at, expected) => {
      const deps = makeDeps({ now: () => at as number });

      await handleBillableEventPoke(makeEvent("proj-1"), deps);

      expect(deps.dispatchReport).toHaveBeenCalledTimes(expected as number);
      expect(deps.dispatchReport).toHaveBeenCalledWith(expect.objectContaining({ billingMonth: "2026-03" }));
    });

    /** @scenario "Late events inside the grace window still reach the previous month" */
    it("dispatches the previous month before the current one", async () => {
      const deps = makeDeps({ now: () => FIRST_OF_MONTH });

      await handleBillableEventPoke(makeEvent("proj-1"), deps);

      expect(deps.dispatchReport.mock.calls[0]?.[0]).toMatchObject({ billingMonth: "2026-02" });
      expect(deps.dispatchReport.mock.calls[1]?.[0]).toMatchObject({ billingMonth: "2026-03" });
    });
  });
});

describe("billingMeterPokeGroupKey", () => {
  it("is a subscriber lane partitioned by the project, not by event or aggregate", () => {
    expect(billingMeterPokeGroupKey(makeEvent("proj-1"))).toEqual({
      tenantId: "proj-1",
      lane: { kind: "subscriber", name: "billingMeterPoke" },
      scope: { kind: "partition", parts: ["proj-1"] },
    });
  });
});

describe("billingMeterPokeDedupId", () => {
  describe("given many events from one project", () => {
    /** @scenario "Rapid billable events collapse onto one usage report" */
    it("keys every one onto the same project-scoped dedup id", () => {
      const first = billingMeterPokeDedupId(makeEvent("proj-1"));
      const second = billingMeterPokeDedupId(makeEvent("proj-1"));
      const other = billingMeterPokeDedupId(makeEvent("proj-2"));

      expect(first).toBe(second);
      expect(first).not.toBe(other);
    });

    it("is the rendered group key, not a hand-concatenated string", () => {
      // ADR-100: the dedup key must be derived from the same descriptor as
      // the lane it identifies, never a separate hand-written convention.
      expect(billingMeterPokeDedupId(makeEvent("proj-1"))).toBe(
        renderGroupKey(billingMeterPokeGroupKey(makeEvent("proj-1"))),
      );
    });
  });
});

describe("createBillingMeterPokeMount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given many events from one project", () => {
    /** @scenario "Rapid billable events collapse onto one usage report" */
    it("holds the dedup key for the debounce window", () => {
      const mount = createBillingMeterPokeMount({
        eventTypes: ["lw.obs.trace.span_received"],
        isSaas: true,
        dispatchReport: vi.fn(),
      });

      expect(mount.deduplication.ttlMs).toBe(300_000);
      expect(mount.deduplication.makeId(makeEvent("proj-1"))).toBe(billingMeterPokeDedupId(makeEvent("proj-1")));
    });
  });

  describe("given a non-SaaS build", () => {
    /** @scenario "Self-hosted builds never poke the usage meter" */
    it("mounts disabled", () => {
      const mount = createBillingMeterPokeMount({
        eventTypes: ["lw.obs.trace.span_received"],
        isSaas: false,
        dispatchReport: vi.fn(),
      });

      expect(mount.disabled).toBe(true);
    });
  });

  describe("given a SaaS build", () => {
    it("mounts enabled", () => {
      const mount = createBillingMeterPokeMount({
        eventTypes: ["lw.obs.trace.span_received"],
        isSaas: true,
        dispatchReport: vi.fn(),
      });

      expect(mount.disabled).toBe(false);
    });
  });

  describe("given the poke is mounted on all four billable pipelines", () => {
    /** @scenario "One kill switch stops the poke everywhere it is mounted" */
    it("carries the identical kill switch key regardless of which pipeline's event types it is mounted with", () => {
      const mountedEventTypeSets = [
        ["lw.obs.trace.span_received"],
        ["lw.evaluation.reported"],
        ["lw.experiment_run.started", "lw.experiment_run.evaluator_result", "lw.experiment_run.target_result"],
        ["lw.simulation_run.started", "lw.simulation_run.message_snapshot"],
      ];

      const killSwitchKeys = mountedEventTypeSets.map(
        (eventTypes) =>
          createBillingMeterPokeMount({ eventTypes, isSaas: true, dispatchReport: vi.fn() }).killSwitchKey,
      );

      // One switch, not one derived per mount: stopping the poke during an
      // incident must not require finding and flipping four separate flags.
      expect(new Set(killSwitchKeys).size).toBe(1);
    });
  });

  describe("given a mounted poke handling an event", () => {
    it("delegates to handleBillableEventPoke with the supplied deps", async () => {
      const dispatchReport = vi.fn().mockResolvedValue(undefined);
      const resolveOrganizationId = vi.fn().mockResolvedValue("org-1");
      const mount = createBillingMeterPokeMount({
        eventTypes: ["lw.obs.trace.span_received"],
        isSaas: true,
        dispatchReport,
        resolveOrganizationId,
        now: () => MID_MONTH,
      });

      await mount.handle(makeEvent("proj-1"));

      expect(resolveOrganizationId).toHaveBeenCalledWith("proj-1");
      expect(dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1", billingMonth: "2026-02" }),
      );
    });
  });
});
