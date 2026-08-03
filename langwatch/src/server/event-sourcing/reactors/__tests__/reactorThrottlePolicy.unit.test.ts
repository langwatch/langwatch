import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createGatewayBudgetSyncReactor } from "@ee/governance/reactors/gatewayBudgetSync.reactor";
import { createGovernanceKpisSyncReactor } from "@ee/governance/reactors/governanceKpisSync.reactor";
import { createGovernanceOcsfEventsSyncReactor } from "@ee/governance/reactors/governanceOcsfEventsSync.reactor";
import { createProjectMetadataReactor } from "../../pipelines/trace-processing/reactors/projectMetadata.reactor";
import { createSpanStorageBroadcastReactor } from "../../pipelines/trace-processing/reactors/spanStorageBroadcast.reactor";
import { createTraceUpdateBroadcastReactor } from "../../pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";
import { createBillingMeterDispatchReactor } from "../../projections/global/billingMeterDispatch.reactor";
import type { ReactorDefinition } from "../reactor.types";

const anyDeps = {} as never;

/** The policy only ever reads `options`, so the generic parameters do not matter. */
type AnyReactor = ReactorDefinition<never, never>;

/**
 * Every reactor that holds events in a window, with the window it must use.
 *
 * The numbers are the point of the policy, not an implementation detail: each
 * one was chosen against a specific consumer's tolerance, and widening it
 * silently is how a reactor starts costing a user latency nobody signed off
 * on. They are written as literals here so changing one has to change this
 * table too, next to the reason it is what it is.
 */
const windowed = [
  {
    name: "traceUpdateBroadcast",
    // Nothing polls behind it while the live stream is connected.
    windowMs: 2_000,
    dedupTtlMs: 2_000,
    reactor: createTraceUpdateBroadcastReactor({
      broadcast: anyDeps,
      hasRedis: true,
    }) as unknown as AnyReactor,
  },
  {
    name: "projectMetadata",
    // Roughly one poll of the onboarding screen waiting on its flags.
    windowMs: 3_000,
    dedupTtlMs: 3_000,
    reactor: createProjectMetadataReactor({
      projects: anyDeps,
    }) as unknown as AnyReactor,
  },
  {
    name: "governanceKpisSync",
    // Hour-bucketed rows read by a five-minute worker.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    reactor: createGovernanceKpisSyncReactor(anyDeps) as unknown as AnyReactor,
  },
  {
    name: "governanceOcsfEventsSync",
    // Cursor-paginated export pulls pick up a late row on the next pass.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    reactor: createGovernanceOcsfEventsSyncReactor(
      anyDeps,
    ) as unknown as AnyReactor,
  },
  {
    name: "billingMeterDispatch",
    // Suppression outlives the window here, sized to the downstream command's
    // own dedup so the two agree on the rate.
    windowMs: 30_000,
    dedupTtlMs: 300_000,
    reactor: createBillingMeterDispatchReactor({
      getDispatch: () => async () => {},
    }) as unknown as AnyReactor,
  },
] as const satisfies readonly {
  name: string;
  windowMs: number;
  dedupTtlMs: number;
  reactor: AnyReactor;
}[];

describe("reactor throttle policy", () => {
  describe.each(windowed)("given the $name reactor", ({
    reactor,
    windowMs,
    dedupTtlMs,
  }) => {
    it("holds events for exactly the window the policy assigns it", () => {
      expect(reactor.options?.delay).toBe(windowMs);
    });

    it("pins the window's deadline so a continuous stream cannot defer it forever", () => {
      expect(reactor.options?.deduplication?.extend).toBe(false);
    });

    it("keeps its dedup key alive for exactly the suppression the policy assigns it", () => {
      expect(reactor.options?.deduplication?.ttlMs).toBe(dedupTtlMs);
    });

    it("never lets the key expire before the job it is holding dispatches", () => {
      const { delay, deduplication } = reactor.options!;
      expect(deduplication?.ttlMs).toBeGreaterThanOrEqual(delay!);
    });

    it("collapses on the same job id the router collapses on", () => {
      expect(reactor.options?.makeJobId).toBe(
        reactor.options?.deduplication?.makeId,
      );
    });
  });

  describe("given work whose result depends on the event that triggered it", () => {
    // These rebuild their output from the fold's running state, or notify a
    // client that the state moved. Dropping the LAST event of an aggregate
    // would leave the previous partial write as the final answer.
    const levelTriggered = windowed.filter(
      ({ name }) => name !== "billingMeterDispatch",
    );

    it.each(levelTriggered)("lets $name re-trigger after it fires", ({
      reactor,
    }) => {
      expect(reactor.options?.deduplication?.shouldSurviveDispatch).toBe(false);
    });
  });

  describe("given work that reads nothing from its triggering event", () => {
    it("keeps billingMeterDispatch suppressed for the rest of its window", () => {
      const reactor = createBillingMeterDispatchReactor({
        getDispatch: () => async () => {},
      });

      expect(reactor.options?.deduplication?.shouldSurviveDispatch).toBe(true);
    });
  });

  describe("given a consumer that cannot absorb added latency", () => {
    // Both are deliberately excluded. Read the comment on each reactor before
    // adding a window here — the reasons are specific, not incidental.
    it("leaves gatewayBudgetSync firing immediately, because a budget block reads what it writes", () => {
      const reactor = createGatewayBudgetSyncReactor(anyDeps);

      expect(reactor.options?.delay ?? 0).toBe(0);
    });

    it("leaves spanStorageBroadcast firing immediately, because nothing polls behind it while a trace is open", () => {
      const reactor = createSpanStorageBroadcastReactor({
        broadcast: anyDeps,
        hasRedis: true,
      });

      expect(reactor.options?.delay ?? 0).toBe(0);
    });
  });
});
