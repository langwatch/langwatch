/**
 * `EventProducer` (ADR-107 decision 15, ADR-108 decisions 2, 6, 7, 9).
 *
 * Appends to the log first — the log is the sole writer — then fans out one
 * staged job per subscribing fold, map, subscriber and process manager. Fan-out
 * is best-effort: nothing it does may undo a write that already landed, so
 * every stage that can fail is isolated and counted rather than thrown.
 *
 * `BuiltPipeline.aggregateIdFor` (ADR-107 decision 4) and a member's own
 * `scopeFor`/`enqueueFilter`/`stageReference` (ADR-108 decision 9) are read
 * structurally via {@link FanoutMember} rather than by widening
 * `BuiltPipeline`/`BuiltFold`/etc., which this file does not own.
 */

import { EventSourcingError } from "../errors";
import { noopMetrics } from "../ports/metrics";
import type {
  BuiltPipeline,
  CommittedEvent,
  EventLog,
  EventProducer,
  GroupKey,
  Lane,
  LaneQueue,
  Metrics,
  Registry,
  Scope,
  StagedJob,
} from "./contracts";

export interface EventProducerDeps {
  readonly eventLog: EventLog;
  readonly queue: LaneQueue;
  readonly registry: Registry;
  readonly metrics?: Metrics;
}

interface AggregateIdCapable {
  aggregateIdFor(eventType: string, payload: unknown): string;
}

interface FanoutMember {
  readonly scopeFor?: (eventType: string, payload: unknown) => Scope;
  readonly enqueueFilter?: (eventType: string, payload: unknown) => boolean;
  readonly stageReference?: (
    event: CommittedEvent,
  ) => string | null | undefined;
}

interface Subscription {
  readonly pipeline: BuiltPipeline;
  readonly lane: Lane;
}

function memberFor(
  pipeline: BuiltPipeline,
  lane: Lane,
): FanoutMember | undefined {
  switch (lane.kind) {
    case "fold":
      return pipeline.folds[lane.name] as unknown as FanoutMember | undefined;
    case "map":
      return pipeline.maps[lane.name] as unknown as FanoutMember | undefined;
    case "subscriber":
      return pipeline.subscribers[lane.name] as unknown as
        | FanoutMember
        | undefined;
    case "processManager":
      return pipeline.processManagers[lane.name] as unknown as
        | FanoutMember
        | undefined;
    default:
      return undefined;
  }
}

export function createEventProducer(deps: EventProducerDeps): EventProducer {
  const metrics = deps.metrics ?? noopMetrics;
  const fanoutIssues = metrics.counter({
    name: "es_producer_fanout_issues_total",
    help: "Fan-out issues after a committed write: a lost job, or a filter/hook overridden for safety.",
    labelNames: ["stage"],
  });

  function subscriptionsFor(eventType: string): Subscription[] {
    const registry = deps.registry;
    return [
      ...registry.foldsFor(eventType).map(
        ({ pipeline, name }): Subscription => ({
          pipeline,
          lane: { kind: "fold", name },
        }),
      ),
      ...registry.mapsFor(eventType).map(
        ({ pipeline, name }): Subscription => ({
          pipeline,
          lane: { kind: "map", name },
        }),
      ),
      ...registry.subscribersFor(eventType).map(
        ({ pipeline, name }): Subscription => ({
          pipeline,
          lane: { kind: "subscriber", name },
        }),
      ),
      ...registry.processManagersFor(eventType).map(
        ({ pipeline, name }): Subscription => ({
          pipeline,
          lane: { kind: "processManager", name },
        }),
      ),
    ];
  }

  // A fold's and a process manager's lane is always the aggregate the
  // pipeline's own id map resolves (ADR-107 decision 4) — never re-derived by
  // a hand-written helper here. `aggregateType` comes from the event itself,
  // which already carries it; only the id is the pipeline's to name.
  function scopeFor(args: {
    pipeline: BuiltPipeline;
    lane: Lane;
    event: CommittedEvent;
    payload: unknown;
  }): Scope {
    const { pipeline, lane, event, payload } = args;
    if (lane.kind === "fold" || lane.kind === "processManager") {
      const capable = pipeline as unknown as AggregateIdCapable;
      return {
        kind: "aggregate",
        aggregateType: event.aggregateType,
        aggregateId: capable.aggregateIdFor(event.eventType, payload),
      };
    }
    const resolve = memberFor(pipeline, lane)?.scopeFor;
    if (!resolve) {
      throw new EventSourcingError(
        `producer: ${lane.kind} "${lane.name}" declares no scope`,
        { lane: lane.kind, name: lane.name },
      );
    }
    return resolve(event.eventType, payload);
  }

  function shouldEnqueue(args: {
    member: FanoutMember | undefined;
    lane: Lane;
    event: CommittedEvent;
    payload: unknown;
  }): boolean {
    const filter = args.member?.enqueueFilter;
    if (!filter) return true;
    try {
      return filter(args.event.eventType, args.payload);
    } catch {
      // A total predicate that throws anyway must never lose the job it
      // guards — the routing path has no retry (ADR-108 decision 9).
      fanoutIssues.inc({ stage: "enqueueFilter" });
      return true;
    }
  }

  function bodyFor(
    member: FanoutMember | undefined,
    event: CommittedEvent,
  ): string {
    if (!member?.stageReference) return event.payload;
    try {
      return member.stageReference(event) ?? event.payload;
    } catch {
      return event.payload;
    }
  }

  function buildJob(args: {
    subscription: Subscription;
    event: CommittedEvent;
    payload: unknown;
    costBytes: number;
  }): StagedJob | null {
    const { subscription, event, payload, costBytes } = args;
    const { pipeline, lane } = subscription;
    const member = memberFor(pipeline, lane);

    if (!shouldEnqueue({ member, lane, event, payload })) return null;

    const descriptor: GroupKey = {
      tenantId: event.tenantId,
      lane,
      scope: scopeFor({ pipeline, lane, event, payload }),
    };

    return {
      descriptor,
      // A convergence accelerator, not a correctness guarantee (ADR-107
      // decision 8) — the queue assigns the actual sequence at stage time.
      orderingKey: event.occurredAt,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      eventId: event.eventId,
      costBytes,
      body: bodyFor(member, event),
    };
  }

  function jobsForEvent(event: CommittedEvent): StagedJob[] {
    // Parsed once, to resolve routing — the string itself is never re-encoded;
    // `event.payload` and the deployed `EventPayload`/job body all stay the
    // one string the command produced.
    const payload = JSON.parse(event.payload) as unknown;
    const costBytes = Buffer.byteLength(event.payload, "utf8");

    const jobs: StagedJob[] = [];
    for (const subscription of subscriptionsFor(event.eventType)) {
      try {
        const job = buildJob({ subscription, event, payload, costBytes });
        if (job) jobs.push(job);
      } catch {
        fanoutIssues.inc({ stage: "member" });
      }
    }
    return jobs;
  }

  async function fanOut(events: readonly CommittedEvent[]): Promise<void> {
    const jobs: StagedJob[] = [];
    for (const event of events) {
      try {
        jobs.push(...jobsForEvent(event));
      } catch {
        fanoutIssues.inc({ stage: "event" });
      }
    }
    if (jobs.length === 0) return;
    await deps.queue.stage(jobs);
  }

  return {
    async publish(events: readonly CommittedEvent[]): Promise<void> {
      await deps.eventLog.append(events);
      try {
        await fanOut(events);
      } catch {
        // The write already landed — a staging failure is reported and
        // swallowed, never propagated (ADR-107 decision 15).
        fanoutIssues.inc({ stage: "queue" });
      }
    },
  };
}
