import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  createGovernanceKpisSyncHandler,
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  isGovernanceKpiTrace,
} from "@ee/governance/subscribers/governanceKpisSync.subscriber";
import {
  createGovernanceOcsfEventsSyncHandler,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  isGovernanceOcsfTrace,
} from "@ee/governance/subscribers/governanceOcsfEventsSync.subscriber";
import {
  type CodingAgentProcessingPipelineDeps,
  createCodingAgentProcessingPipeline,
} from "../../pipelines/coding-agent-processing/pipeline";
import { createPullRequestMappingHandler } from "../../pipelines/coding-agent-processing/subscribers/pullRequestMapping.subscriber";
import { buildTraceDeps } from "../../pipelines/trace-processing/__tests__/support/traceProcessingFixtures";
import { createTraceProcessingPipeline } from "../../pipelines/trace-processing/pipeline";
import { createBillingMeterDispatchSubscriber } from "../../projections/global/billingMeterDispatch.subscriber";
import type { ReactorDefinition } from "../reactor.types";
import { throttledWindow } from "../throttleWindow";

const anyDeps = {} as never;

/** The policy only ever reads `options`, so the generic parameters do not matter. */
type AnyReactor = ReactorDefinition<never, never>;

/**
 * The registrations under test come off the REAL pipelines — the throttle now
 * lives on the pipeline declaration, so reading it anywhere else would pin a
 * copy rather than the policy.
 */
const tracePipeline = createTraceProcessingPipeline(
  buildTraceDeps({
    governanceKpisSync: {
      fold: "traceSummary",
      when: isGovernanceKpiTrace,
      ...throttledWindow({
        makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
        windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
      }),
      handler: createGovernanceKpisSyncHandler(anyDeps),
    },
    governanceOcsfEventsSync: {
      fold: "traceSummary",
      when: isGovernanceOcsfTrace,
      ...throttledWindow({
        makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
        windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
      }),
      handler: createGovernanceOcsfEventsSyncHandler(anyDeps),
    },
  }),
);

const codingAgentStore = {} as never;
const codingAgentPipeline = createCodingAgentProcessingPipeline({
  codingAgentSessionStore: codingAgentStore,
  codingAgentTraceSessionAppendStore: codingAgentStore,
  sessionMetricSeriesAppendStore: codingAgentStore,
  codingAgentSessionEventsAppendStore: codingAgentStore,
  pullRequestMappingHandler: createPullRequestMappingHandler({
    requestBranchMapping: async () => {},
  }),
} as unknown as CodingAgentProcessingPipelineDeps);

function traceRegistration(name: string): AnyReactor {
  return tracePipeline.foldReactors.get(name)!.definition as AnyReactor;
}

/**
 * Every reactor that holds events in a window, with the window it must use and
 * whether its suppression outlives a dispatch.
 *
 * The numbers are the point of the policy, not an implementation detail: each
 * one was chosen against a specific consumer's tolerance, and widening it
 * silently is how a reactor starts costing a user latency nobody signed off
 * on. They are written as literals here so changing one has to change this
 * table too, next to the reason it is what it is.
 *
 * `survivesDispatch` is the same bargain for a decision that is not a number.
 * Suppressing past dispatch discards triggers that arrive while the TTL still
 * runs, which is wrong for anything level-triggered and right only where the
 * handler reads nothing from the event it was handed. It stays opt-in, one row
 * at a time, each carrying the argument for why its own case is the second
 * kind.
 */
const windowed = [
  {
    name: "traceUpdateBroadcast",
    // Nothing polls behind it while the live stream is connected.
    windowMs: 2_000,
    dedupTtlMs: 2_000,
    // Level-triggered: it tells a connected client the trace moved, so
    // swallowing the last event leaves that client on the previous state.
    survivesDispatch: false,
    reactor: traceRegistration("traceUpdateBroadcast"),
  },
  {
    name: "projectMetadata",
    // Roughly one poll of the onboarding screen waiting on its flags.
    windowMs: 3_000,
    dedupTtlMs: 3_000,
    // Rebuilt from the fold's running state, so the final event is the one
    // that decides the row.
    survivesDispatch: false,
    reactor: traceRegistration("projectMetadata"),
  },
  {
    name: "governanceKpisSync",
    // Hour-bucketed rows read by a five-minute worker.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    // Same: the last contribution to an hour bucket is what makes it correct.
    survivesDispatch: false,
    reactor: traceRegistration("governanceKpisSync"),
  },
  {
    name: "governanceOcsfEventsSync",
    // Cursor-paginated export pulls pick up a late row on the next pass.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    // The sync writes what the fold currently holds, so a dropped last event
    // is a row that never ships.
    survivesDispatch: false,
    reactor: traceRegistration("governanceOcsfEventsSync"),
  },
  {
    name: "pullRequestMapping",
    // Lag a developer watching for their branch's pull request would feel.
    // The hours-long protection for GitHub is the durable branch bookkeeping
    // in the mapping service, not this window.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    // The one opt-in, and it reads nothing from the event: the handler asks
    // GitHub one idempotent question about one branch. It needs the TTL past
    // dispatch because a reactor's ready score is the event's own `createdAt`,
    // so a group draining a backlog stages jobs whose deadline has already
    // passed and the window collapses nothing. What it discards is a re-ask of
    // the identical question inside thirty seconds, which the mapping
    // service's own bookkeeping would have refused one layer down.
    survivesDispatch: true,
    reactor: codingAgentPipeline.foldReactors.get("pullRequestMapping")!
      .definition as AnyReactor,
  },
] as const satisfies readonly {
  name: string;
  windowMs: number;
  dedupTtlMs: number;
  survivesDispatch: boolean;
  reactor: AnyReactor;
}[];

describe("subscriber throttle policy", () => {
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

  describe("given a trigger that arrives after the window has already fired", () => {
    // Most of these rebuild their output from the fold's running state, or
    // notify a client that the state moved, so they have to re-trigger:
    // dropping the LAST event of an aggregate would leave the previous partial
    // write as the final answer. The table says which is which, and why.
    it.each(
      windowed,
    )("holds $name to the post-dispatch suppression the policy allows it", ({
      reactor,
      survivesDispatch,
    }) => {
      expect(reactor.options?.deduplication?.shouldSurviveDispatch).toBe(
        survivesDispatch,
      );
    });

    // The table above only binds a reactor to the decision written next to it,
    // so on its own it would follow a reactor that quietly opted in. This is
    // what makes opting in cost an edit here, argued for by name.
    it("keeps suppression past a dispatch an exception", () => {
      expect(
        windowed
          .filter((entry) => entry.survivesDispatch)
          .map(({ name }) => name),
      ).toEqual(["pullRequestMapping"]);
    });
  });

  describe("given a consumer that cannot absorb added latency", () => {
    // Deliberately excluded. Read the comment on the reactor before adding a
    // window here — the reason is specific, not incidental.
    it("leaves spanStorageBroadcast firing immediately, because nothing polls behind it while a trace is open", () => {
      const reactor = tracePipeline.mapReactors.get(
        "spanStorageBroadcast",
      )!.definition;

      expect(reactor.options?.delay ?? 0).toBe(0);
    });

    it("leaves billingMeterDispatch firing immediately, because its handler reads the clock rather than the event", () => {
      // Holding a trigger moves the billing-month and grace-period decision
      // with it, so a delay can turn a late report into a missing one.
      const reactor = createBillingMeterDispatchSubscriber({
        getDispatch: () => async () => {},
      });

      expect(reactor.options?.delay ?? 0).toBe(0);
    });

    it("never suppresses a billing trigger after one has dispatched", () => {
      // Its dedup TTL outlives a dispatch, so if the key ALSO survived
      // dispatch a trigger just after a UTC month rollover could be discarded
      // and that month's first report skipped. Post-dispatch suppression is
      // opt-in, and this reactor must never opt in while the handler decides
      // its billing month from the clock.
      const reactor = createBillingMeterDispatchSubscriber({
        getDispatch: () => async () => {},
      });

      expect(
        reactor.options?.deduplication?.shouldSurviveDispatch ?? false,
      ).toBe(false);
    });
  });
});
