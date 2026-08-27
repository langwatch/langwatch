import { type SubscriberDispatchDefinition, throttledWindow } from "@langwatch/eventing";
import { createPullRequestMappingSubscriber } from "@langwatch/coding-agent-server";
import { describe, expect, it, vi } from "vitest";
import { TestGithubService } from "~/test-utils/test-github.service";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
} from "@langwatch/enterprise-governance-server";
import {
  AppGovernanceSubscriberAdapter,
  GovernanceSubscriberRuntime,
} from "@langwatch/enterprise-api/governance/governance-subscriber.adapter";
import { createBillingMeterDispatchSubscriber } from "~/server/event-sourcing/registration/global/billingMeterDispatch.subscriber";
import { buildTraceDeps } from "./trace-processing/core/support/traceProcessingFixtures";
import { createTraceProcessingPipeline } from "~/runtime/app/trace-processing.adapter";

/** The policy only ever reads `options`, so the generic parameters do not matter. */
type AnySubscriber = SubscriberDispatchDefinition<never, never>;

/**
 * The registrations under test come off the REAL pipelines — the throttle now
 * lives on the pipeline declaration, so reading it anywhere else would pin a
 * copy rather than the policy.
 */
class TestGovernanceSubscriberRuntime extends GovernanceSubscriberRuntime {
  capture(): void {}

  passesTraceOriginGuard(): boolean {
    return true;
  }

  countAutomationMatchRecords(): void {}
}

const governanceSubscribers = AppGovernanceSubscriberAdapter.create(
  new TestGovernanceSubscriberRuntime(),
);
const governanceKpis = governanceSubscribers.kpis({
  insertContribution: async () => {},
});
const governanceOcsf = governanceSubscribers.ocsf({
  insertEvent: async () => {},
});
const tracePipeline = createTraceProcessingPipeline(
  buildTraceDeps({
    governanceKpisSync: {
      fold: "traceSummary",
      when: (event, context) => governanceKpis.when(event, context),
      ...throttledWindow({
        makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
        windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
      }),
      handler: (event, context) => governanceKpis.handle(event, context),
    },
    governanceOcsfEventsSync: {
      fold: "traceSummary",
      when: (event, context) => governanceOcsf.when(event, context),
      ...throttledWindow({
        makeId: (e) => `${e.tenantId}:${e.aggregateId}`,
        windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
      }),
      handler: (event, context) => governanceOcsf.handle(event, context),
    },
  }),
);

const pullRequestMapping = createPullRequestMappingSubscriber(TestGithubService.create());

function traceRegistration(name: string): AnySubscriber {
  return tracePipeline.foldSubscribers.get(name)!.definition as AnySubscriber;
}

function registeredPolicy(subscriber: AnySubscriber) {
  return {
    delay: subscriber.options?.delay,
    ttlMs: subscriber.options?.deduplication?.ttlMs,
    extend: subscriber.options?.deduplication?.extend,
    makeJobId: subscriber.options?.makeJobId,
    dedupId: subscriber.options?.deduplication?.makeId,
    shouldSurviveDispatch: subscriber.options?.deduplication?.shouldSurviveDispatch,
  };
}

function pullRequestMappingPolicy() {
  const deduplication = pullRequestMapping.dedup;
  if (deduplication === undefined || deduplication === "aggregate") {
    throw new Error("Pull-request mapping must declare its throttle window");
  }

  return {
    delay: pullRequestMapping.delay,
    ttlMs: deduplication.ttlMs,
    extend: deduplication.extend,
    makeJobId: deduplication.makeId,
    dedupId: deduplication.makeId,
    shouldSurviveDispatch: deduplication.shouldSurviveDispatch,
  };
}

/**
 * Every subscriber that holds events in a window, with the window it must use and
 * whether its suppression outlives a dispatch.
 *
 * The numbers are the point of the policy, not an implementation detail: each
 * one was chosen against a specific consumer's tolerance, and widening it
 * silently is how a subscriber starts costing a user latency nobody signed off
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
    policy: registeredPolicy(traceRegistration("traceUpdateBroadcast")),
  },
  {
    name: "projectMetadata",
    // Roughly one poll of the onboarding screen waiting on its flags.
    windowMs: 3_000,
    dedupTtlMs: 3_000,
    // Rebuilt from the fold's running state, so the final event is the one
    // that decides the row.
    survivesDispatch: false,
    policy: registeredPolicy(traceRegistration("projectMetadata")),
  },
  {
    name: "governanceKpisSync",
    // Hour-bucketed rows read by a five-minute worker.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    // Same: the last contribution to an hour bucket is what makes it correct.
    survivesDispatch: false,
    policy: registeredPolicy(traceRegistration("governanceKpisSync")),
  },
  {
    name: "governanceOcsfEventsSync",
    // Cursor-paginated export pulls pick up a late row on the next pass.
    windowMs: 30_000,
    dedupTtlMs: 30_000,
    // The sync writes what the fold currently holds, so a dropped last event
    // is a row that never ships.
    survivesDispatch: false,
    policy: registeredPolicy(traceRegistration("governanceOcsfEventsSync")),
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
    // dispatch because a subscriber's ready score is the event's own `createdAt`,
    // so a group draining a backlog stages jobs whose deadline has already
    // passed and the window collapses nothing. What it discards is a re-ask of
    // the identical question inside thirty seconds, which the mapping
    // service's own bookkeeping would have refused one layer down.
    survivesDispatch: true,
    policy: pullRequestMappingPolicy(),
  },
] as const satisfies readonly {
  name: string;
  windowMs: number;
  dedupTtlMs: number;
  survivesDispatch: boolean;
  policy: ReturnType<typeof registeredPolicy>;
}[];

describe("subscriber throttle policy", () => {
  describe.each(windowed)("given the $name subscriber", ({ policy, windowMs, dedupTtlMs }) => {
    it("holds events for exactly the window the policy assigns it", () => {
      expect(policy.delay).toBe(windowMs);
    });

    it("pins the window's deadline so a continuous stream cannot defer it forever", () => {
      expect(policy.extend).toBe(false);
    });

    it("keeps its dedup key alive for exactly the suppression the policy assigns it", () => {
      expect(policy.ttlMs).toBe(dedupTtlMs);
    });

    it("never lets the key expire before the job it is holding dispatches", () => {
      expect(policy.ttlMs).toBeGreaterThanOrEqual(policy.delay ?? 0);
    });

    it("collapses on the same job id the router collapses on", () => {
      expect(policy.makeJobId).toBe(policy.dedupId);
    });
  });

  describe("given a trigger that arrives after the window has already fired", () => {
    // Most of these rebuild their output from the fold's running state, or
    // notify a client that the state moved, so they have to re-trigger:
    // dropping the LAST event of an aggregate would leave the previous partial
    // write as the final answer. The table says which is which, and why.
    it.each(windowed)(
      "holds $name to the post-dispatch suppression the policy allows it",
      ({ policy, survivesDispatch }) => {
        expect(policy.shouldSurviveDispatch).toBe(survivesDispatch);
      },
    );

    // The table above only binds a subscriber to the decision written next to it,
    // so on its own it would follow a subscriber that quietly opted in. This is
    // what makes opting in cost an edit here, argued for by name.
    it("keeps suppression past a dispatch an exception", () => {
      expect(windowed.filter((entry) => entry.survivesDispatch).map(({ name }) => name)).toEqual([
        "pullRequestMapping",
      ]);
    });
  });

  describe("given a consumer that cannot absorb added latency", () => {
    // Deliberately excluded. Read the comment on the subscriber before adding a
    // window here — the reason is specific, not incidental.
    it("leaves spanStorageBroadcast firing immediately, because nothing polls behind it while a trace is open", () => {
      const subscriber = tracePipeline.mapSubscribers.get("spanStorageBroadcast")!.definition;

      expect(subscriber.options?.delay ?? 0).toBe(0);
    });

    it("leaves billingMeterDispatch firing immediately, because its handler reads the clock rather than the event", () => {
      // Holding a trigger moves the billing-month and grace-period decision
      // with it, so a delay can turn a late report into a missing one.
      const subscriber = createBillingMeterDispatchSubscriber({
        getDispatch: () => async () => {},
      });

      expect(subscriber.options?.delay ?? 0).toBe(0);
    });

    it("never suppresses a billing trigger after one has dispatched", () => {
      // Its dedup TTL outlives a dispatch, so if the key ALSO survived
      // dispatch a trigger just after a UTC month rollover could be discarded
      // and that month's first report skipped. Post-dispatch suppression is
      // opt-in, and this subscriber must never opt in while the handler decides
      // its billing month from the clock.
      const subscriber = createBillingMeterDispatchSubscriber({
        getDispatch: () => async () => {},
      });

      expect(subscriber.options?.deduplication?.shouldSurviveDispatch ?? false).toBe(false);
    });
  });
});
