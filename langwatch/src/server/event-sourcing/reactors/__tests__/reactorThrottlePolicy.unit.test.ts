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

/** Every reactor that holds events in a window, with the window it uses. */
const windowed: { name: string; reactor: ReactorDefinition<never, never> }[] = [
  {
    name: "traceUpdateBroadcast",
    reactor: createTraceUpdateBroadcastReactor({
      broadcast: anyDeps,
      hasRedis: true,
    }) as never,
  },
  {
    name: "projectMetadata",
    reactor: createProjectMetadataReactor({ projects: anyDeps }) as never,
  },
  {
    name: "governanceKpisSync",
    reactor: createGovernanceKpisSyncReactor(anyDeps) as never,
  },
  {
    name: "governanceOcsfEventsSync",
    reactor: createGovernanceOcsfEventsSyncReactor(anyDeps) as never,
  },
  {
    name: "billingMeterDispatch",
    reactor: createBillingMeterDispatchReactor({
      getDispatch: () => async () => {},
    }) as never,
  },
];

describe("reactor throttle policy", () => {
  describe.each(windowed)("given the $name reactor", ({ reactor }) => {
    it("holds events for a window instead of firing on every event", () => {
      expect(reactor.options?.delay).toBeGreaterThan(0);
    });

    it("pins the window's deadline so a continuous stream cannot defer it forever", () => {
      expect(reactor.options?.deduplication?.extend).toBe(false);
    });

    it("keeps a dedup ttl at least as long as the window, so the key outlives the wait", () => {
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
