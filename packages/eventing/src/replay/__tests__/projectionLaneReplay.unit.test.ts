/** Spec: specs/upgrade/projection-replay-step.feature. */
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types.ts";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types.ts";
import { sealFoldProjection } from "../../projections/sealedProjection.ts";
import type { RetentionPolicyResolver } from "../../runtime.types.ts";
import { ProjectionLaneNotFoundError, projectionLaneReplayer } from "../projectionLaneReplay.ts";
import { REPLAY_CURSOR_SKEW_MARGIN_MS } from "../replayConstants.ts";
import type {
  CutoffInfo,
  DiscoveredAggregateWithEventTypes,
  OccurredAtBounds,
  ReplayEvent,
  ReplayEventSource,
} from "../replayEventSource.ts";
import { aggregateKey } from "../replayMarkers.ts";
import type { ReplayProjections } from "../replayProjections.ts";
import { ReplayService } from "../replayService.ts";
import type { RegisteredFoldProjection } from "../types.ts";

const PAUSED_SET_KEY = "{event-sourcing/jobs}:gq:paused-jobs";
const LANE = "directoryMembers";
const PAUSE_KEY = `global/projection/${LANE}`;
const FROM_START = "1970-01-01T00:00:00Z";
const BASE_MS = 1_700_000_000_000;

type Matching = { eventTypes: readonly string[]; sinceMs?: number; tenantId?: string };

/** The owner's log, answering the reads the engine makes; records whether the lane was paused. */
class SeededLog implements ReplayEventSource {
  readonly pausedAtCutoff: boolean[] = [];
  readonly discoveredFor: (string | undefined)[] = [];
  onCutoff: () => void = () => undefined;
  constructor(
    readonly events: ReplayEvent[],
    private readonly pausedNow: () => Promise<boolean>,
  ) {}

  protected matching({ eventTypes, sinceMs, tenantId }: Matching): ReplayEvent[] {
    return this.events.filter(
      (event) =>
        eventTypes.includes(event.type) &&
        (sinceMs === undefined || event.timestamp >= sinceMs) &&
        (tenantId === undefined || event.tenantId === tenantId),
    );
  }

  async discoverAffectedAggregates(input: Matching): Promise<DiscoveredAggregateWithEventTypes[]> {
    this.discoveredFor.push(input.tenantId);
    const byKey = new Map<string, DiscoveredAggregateWithEventTypes>();
    for (const event of this.matching(input)) {
      byKey.set(aggregateKey(event), {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [event.type],
      });
    }
    return [...byKey.values()];
  }

  async countEventsForAggregates(input: Matching): Promise<number> {
    return this.matching(input).length;
  }

  async getBoundedCutoffs(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
  }): Promise<{
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds: OccurredAtBounds | undefined;
  }> {
    this.pausedAtCutoff.push(await this.pausedNow());
    this.onCutoff();
    const cutoffs = new Map<string, CutoffInfo>();
    const selected = this.ofAggregates(input);
    for (const event of selected) {
      const current = cutoffs.get(aggregateKey(event));
      if (!current || event.timestamp > current.timestamp) {
        cutoffs.set(aggregateKey(event), { timestamp: event.timestamp, eventId: event.id });
      }
    }
    if (selected.length === 0) return { cutoffs, occurredAtBounds: undefined };
    const occurred = selected.map((event) => event.occurredAt);
    return {
      cutoffs,
      occurredAtBounds: { minMs: Math.min(...occurred), maxMs: Math.max(...occurred) },
    };
  }

  async streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    const selected = this.ofAggregates(input).filter((event) => {
      const cutoff = input.cutoffs.get(aggregateKey(event));
      return cutoff !== undefined && event.timestamp <= cutoff.timestamp;
    });
    for (const event of selected) await input.onEvent(event);
    return { eventsApplied: selected.length };
  }

  async loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
  }): Promise<ReplayEvent[]> {
    return this.ofAggregates(input)
      .filter((event) => event.timestamp <= input.maxCutoff.timestamp)
      .filter((event) => input.cursor === undefined || event.timestamp > input.cursor.timestamp)
      .slice(0, input.batchSize);
  }

  private ofAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
  }): ReplayEvent[] {
    return this.matching(input)
      .filter((event) => input.aggregateIds.includes(event.aggregateId))
      .toSorted((a, b) => a.timestamp - b.timestamp);
  }
}

/** The same log, able to list the tenants holding a lane's events. */
class TenantListingLog extends SeededLog {
  async discoverTenants(input: Matching): Promise<string[]> {
    return [...new Set(this.matching(input).map((event) => event.tenantId))].toSorted();
  }
}

function seededEvent({
  n,
  aggregateId,
  tenantId = "tenant-1",
  at = BASE_MS + n,
}: {
  n: number;
  aggregateId: string;
  tenantId?: string;
  at?: number;
}): ReplayEvent {
  return {
    id: `event-${n}`,
    aggregateId,
    aggregateType: "directory",
    tenantId,
    createdAt: at,
    timestamp: at,
    occurredAt: at,
    type: "directory.member_added",
    version: "2026-10-01",
    idempotencyKey: `event-${n}`,
    data: {},
  };
}

/** A fold lane whose read model is an in-memory map of member counts per aggregate. */
function foldLane({
  name,
  pauseKey,
  readModel,
  writes,
  retention,
  stamped = new Map(),
}: {
  name: string;
  pauseKey: string;
  readModel: Map<string, number>;
  writes: { count: number };
  retention?: RetentionPolicyResolver;
  stamped?: Map<string, unknown>;
}): RegisteredFoldProjection {
  const definition: FoldProjectionDefinition<{ members: number }, Event> = {
    name,
    version: "v1",
    eventTypes: ["directory.member_added"],
    LastEventOccurredAtKey: "LastEventOccurredAt",
    init: () => ({ members: 0 }),
    apply: (state) => ({ members: state.members + 1 }),
    store: {
      store: async (state, context) => {
        writes.count++;
        readModel.set(context.aggregateId, state.members);
        stamped.set(context.aggregateId, context.retentionPolicy);
      },
      get: async () => ({ kind: "empty" as const }),
    },
  };
  return {
    projectionName: name,
    pipelineName: "global",
    aggregateType: "directory",
    source: "global",
    pauseKey,
    kind: "fold",
    ...(retention === undefined ? {} : { retentionPolicyResolver: retention }),
    ...sealFoldProjection(definition),
  };
}

/** Two tenants' events, a log that lists them, and a lane whose pipeline declares retention. */
function setUpTwoTenants() {
  const redis = memoryRedisDouble({
    script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
  });
  const readModel = new Map<string, number>();
  const stamped = new Map<string, unknown>();
  const retention: RetentionPolicyResolver = {
    resolve: async (tenantId) => ({ days: tenantId === "tenant-1" ? 30 : 90 }),
  };
  const log = new TenantListingLog(
    [
      seededEvent({ n: 1, aggregateId: "directory-a", tenantId: "tenant-1" }),
      seededEvent({ n: 2, aggregateId: "directory-b", tenantId: "tenant-2" }),
      seededEvent({ n: 3, aggregateId: "directory-b", tenantId: "tenant-2" }),
    ],
    async () => (await redis.smembers(PAUSED_SET_KEY)).includes(PAUSE_KEY),
  );
  const lane = foldLane({
    name: LANE,
    pauseKey: PAUSE_KEY,
    readModel,
    writes: { count: 0 },
    retention,
    stamped,
  });
  const replayer = projectionLaneReplayer({
    service: new ReplayService({ eventSource: log, redis }),
    projections: { projections: [lane], mapProjections: [], stateProjections: [] },
  });
  const tenantsDone: { tenantId: string; replayedThrough: string }[] = [];
  const onTenantComplete = (done: { tenantId: string; replayedThrough: string }) =>
    void tenantsDone.push(done);
  return { redis, readModel, stamped, log, replayer, tenantsDone, onTenantComplete };
}

function setUp() {
  const redis = memoryRedisDouble({
    script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
  });
  const readModel = new Map<string, number>();
  const otherReadModel = new Map<string, number>();
  const writes = { count: 0 };
  const log = new SeededLog(
    [
      seededEvent({ n: 1, aggregateId: "directory-a" }),
      seededEvent({ n: 2, aggregateId: "directory-a" }),
      seededEvent({ n: 3, aggregateId: "directory-b" }),
    ],
    async () => (await redis.smembers(PAUSED_SET_KEY)).includes(PAUSE_KEY),
  );
  const projections: ReplayProjections = {
    projections: [
      foldLane({ name: LANE, pauseKey: PAUSE_KEY, readModel, writes }),
      foldLane({
        name: "otherLane",
        pauseKey: "global/projection/otherLane",
        readModel: otherReadModel,
        writes: { count: 0 },
      }),
    ],
    mapProjections: [],
    stateProjections: [],
  };
  const replayer = projectionLaneReplayer({
    service: new ReplayService({ eventSource: log, redis }),
    projections,
  });
  return { redis, readModel, otherReadModel, writes, log, replayer };
}

describe("projectionLaneReplayer", () => {
  describe("given an empty read model and a seeded owner's log", () => {
    /** @scenario "A replay step fills an empty read model from its owner's log" */
    it("fills the named lane from the whole log and no other lane", async () => {
      const { readModel, otherReadModel, replayer } = setUp();

      const result = await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });

      expect(Object.fromEntries(readModel)).toEqual({ "directory-a": 2, "directory-b": 1 });
      expect(otherReadModel.size).toBe(0);
      expect(result).toMatchObject({
        lane: LANE,
        kind: "fold",
        aggregatesReplayed: 2,
        totalEvents: 3,
      });
      expect(Date.parse(result.replayedThrough)).toBeGreaterThan(BASE_MS);
    });
  });

  describe("given a lane already replayed through a cursor", () => {
    /** @scenario "A second run with nothing new in the log changes nothing" */
    it("rebuilds nothing when it resumes from the returned cursor", async () => {
      const { readModel, writes, replayer } = setUp();
      const first = await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });
      const filled = Object.fromEntries(readModel);
      const writesAfterFirst = writes.count;

      const second = await replayer.replayLane({
        lane: LANE,
        since: first.replayedThrough,
        dryRun: false,
      });

      expect(second.aggregatesReplayed).toBe(0);
      expect(writes.count).toBe(writesAfterFirst);
      expect(Object.fromEntries(readModel)).toEqual(filled);
    });
  });

  describe("when the lane is replayed", () => {
    /** @scenario "The lane's live delivery is paused while it replays and resumes after" */
    it("pauses the lane's live delivery for the batch and resumes it after", async () => {
      const { redis, log, replayer } = setUp();

      await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });

      expect(log.pausedAtCutoff).toEqual([true]);
      expect(await redis.smembers(PAUSED_SET_KEY)).not.toContain(PAUSE_KEY);
    });
  });

  describe("when the named lane is declared by no registered pipeline", () => {
    /** @scenario "A lane no registered pipeline declares is refused by name" */
    it("refuses the run naming the lane", async () => {
      const { replayer } = setUp();

      await expect(
        replayer.replayLane({ lane: "missingLane", since: FROM_START, dryRun: false }),
      ).rejects.toMatchObject({
        code: new ProjectionLaneNotFoundError({ lane: "x" }).code,
        lane: "missingLane",
      });
    });
  });

  describe("given an owner's log listing two tenants", () => {
    /** @scenario "A lane is replayed one tenant at a time" */
    it("discovers and replays each tenant on its own", async () => {
      const { log, readModel, replayer } = setUpTwoTenants();

      const result = await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });

      expect(log.discoveredFor).toEqual(["tenant-1", "tenant-2"]);
      expect(Object.fromEntries(readModel)).toEqual({ "directory-a": 1, "directory-b": 2 });
      expect(result).toMatchObject({ aggregatesReplayed: 2, totalEvents: 3 });
    });

    /** @scenario "Each completed tenant is saved with the cursor its run completes through" */
    it("reports each completed tenant with the run's cursor", async () => {
      const { replayer, tenantsDone, onTenantComplete } = setUpTwoTenants();

      const result = await replayer.replayLane({
        lane: LANE,
        since: FROM_START,
        dryRun: false,
        onTenantComplete,
      });

      expect(tenantsDone).toEqual([
        { tenantId: "tenant-1", replayedThrough: result.replayedThrough },
        { tenantId: "tenant-2", replayedThrough: result.replayedThrough },
      ]);
    });

    /** @scenario "A run resumed after an interruption skips the tenants it completed" */
    it("replays only the tenants after the last one done, through the interrupted cursor", async () => {
      const { log, readModel, replayer } = setUpTwoTenants();
      const resume = { replayedThrough: "2026-10-08T09:00:00Z", afterTenant: "tenant-1" };

      const result = await replayer.replayLane({
        lane: LANE,
        since: FROM_START,
        dryRun: false,
        resume,
      });

      expect(log.discoveredFor).toEqual(["tenant-2"]);
      expect(Object.fromEntries(readModel)).toEqual({ "directory-b": 2 });
      expect(result.replayedThrough).toBe(resume.replayedThrough);
    });

    /** @scenario "A worker stop ends the replay without finishing it" */
    it("stops mid-batch, unpauses the lane and completes no tenant", async () => {
      const { redis, log, readModel, replayer, tenantsDone, onTenantComplete } = setUpTwoTenants();
      const stop = new AbortController();
      log.onCutoff = () => stop.abort(new Error("worker stopping"));

      await expect(
        replayer.replayLane({
          lane: LANE,
          since: FROM_START,
          dryRun: false,
          signal: stop.signal,
          onTenantComplete,
        }),
      ).rejects.toThrow("worker stopping");

      expect(log.discoveredFor).toEqual(["tenant-1"]);
      expect(tenantsDone).toEqual([]);
      expect(readModel.size).toBe(0);
      expect(await redis.smembers(PAUSED_SET_KEY)).not.toContain(PAUSE_KEY);
    });

    /** @scenario "A replayed lane stamps the retention its pipeline declares" */
    it("stamps each tenant's rows with the pipeline's retention", async () => {
      const { stamped, replayer } = setUpTwoTenants();

      await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });

      expect(Object.fromEntries(stamped)).toEqual({
        "directory-a": { days: 30 },
        "directory-b": { days: 90 },
      });
    });
  });

  describe("given an owner's log that cannot list its tenants", () => {
    /** @scenario "A log that cannot list its tenants is replayed in one pass" */
    it("discovers every tenant in one pass", async () => {
      const { log, replayer } = setUp();

      await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });

      expect(log.discoveredFor).toEqual([undefined]);
    });
  });

  describe("when a run completes", () => {
    /** @scenario "The cursor a run completes through allows for a lagging clock" */
    it("reports a cursor behind the clock by the skew margin, so a late stamp is replayed next", async () => {
      const { log, readModel, replayer } = setUpTwoTenants();
      const startedAt = Date.now();

      const first = await replayer.replayLane({ lane: LANE, since: FROM_START, dryRun: false });
      const cursorMs = Date.parse(first.replayedThrough);
      expect(cursorMs).toBeGreaterThanOrEqual(startedAt - REPLAY_CURSOR_SKEW_MARGIN_MS);
      expect(cursorMs).toBeLessThanOrEqual(Date.now() - REPLAY_CURSOR_SKEW_MARGIN_MS);

      const lagging = seededEvent({ n: 4, aggregateId: "directory-a", at: startedAt - 60_000 });
      log.events.push(lagging);
      const second = await replayer.replayLane({
        lane: LANE,
        since: first.replayedThrough,
        dryRun: false,
      });

      expect(second.aggregatesReplayed).toBe(1);
      expect(readModel.get("directory-a")).toBe(2);
    });
  });
});
