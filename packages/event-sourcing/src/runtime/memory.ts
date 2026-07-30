import { renderGroupKey } from "../dispatch/groupKey";
import type {
  BlobSpool,
  ClaimedBatch,
  ClaimRequest,
  Clock,
  CommittedEvent,
  DueProcessInstance,
  EventLog,
  EventLogScan,
  Job,
  LaneQueue,
  Lease,
  Outbox,
  OutboxRow,
  ProcessInstanceKey,
  ProcessStore,
  StagedJob,
  StoredProcessState,
} from "./contracts";

export function memoryClock(
  start = 0,
): Clock & { advance(ms: number): void; set(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    set: (ms) => {
      now = ms;
    },
  };
}

export function memoryEventLog(): EventLog & {
  readonly rows: readonly CommittedEvent[];
} {
  const rows: CommittedEvent[] = [];
  return {
    get rows() {
      return rows;
    },
    append(events) {
      for (const event of events) {
        // The deployed sort key dedupes on (tenant, type, id, idempotencyKey).
        const at = rows.findIndex(
          (row) =>
            row.tenantId === event.tenantId &&
            row.aggregateType === event.aggregateType &&
            row.aggregateId === event.aggregateId &&
            row.idempotencyKey === event.idempotencyKey,
        );
        if (at === -1) rows.push(event);
        else rows[at] = event;
      }
      return Promise.resolve();
    },
    async *scan(query: EventLogScan) {
      for (const row of rows) {
        if (row.tenantId !== query.tenantId) continue;
        if (row.aggregateType !== query.aggregateType) continue;
        if (
          query.aggregateId !== undefined &&
          row.aggregateId !== query.aggregateId
        )
          continue;
        if (
          query.occurredFrom !== undefined &&
          row.occurredAt < query.occurredFrom
        )
          continue;
        if (query.occurredTo !== undefined && row.occurredAt > query.occurredTo)
          continue;
        yield row;
      }
    },
  };
}

interface MemoryLane {
  readonly tenantId: string;
  readonly lane: StagedJob["descriptor"]["lane"];
  readonly entries: { readonly score: number; readonly job: Job }[];
  sequence: number;
  leasedBy: string | null;
  failures: number;
  parked: string | null;
  readyAt: number;
}

export interface MemoryQueue extends LaneQueue {
  readonly lanes: ReadonlyMap<string, MemoryLane>;
  parkedLanes(): readonly {
    readonly groupKey: string;
    readonly reason: string;
  }[];
  totalDepth(): number;
}

export function memoryQueue(clock: Clock): MemoryQueue {
  const lanes = new Map<string, MemoryLane>();
  let leaseCounter = 0;

  const laneFor = (job: StagedJob): MemoryLane => {
    const groupKey = renderGroupKey(job.descriptor);
    const existing = lanes.get(groupKey);
    if (existing) return existing;
    const created: MemoryLane = {
      tenantId: job.descriptor.tenantId,
      lane: job.descriptor.lane,
      entries: [],
      sequence: 0,
      leasedBy: null,
      failures: 0,
      parked: null,
      readyAt: 0,
    };
    lanes.set(groupKey, created);
    return created;
  };

  return {
    lanes,
    parkedLanes: () =>
      [...lanes].flatMap(([groupKey, lane]) =>
        lane.parked === null ? [] : [{ groupKey, reason: lane.parked }],
      ),
    totalDepth: () =>
      [...lanes.values()].reduce((sum, lane) => sum + lane.entries.length, 0),

    stage(jobs) {
      for (const job of jobs) {
        const lane = laneFor(job);
        // The sequence is assigned inside the same step that inserts the job,
        // so a job cannot exist without one or share one with a sibling.
        lane.sequence += 1;
        lane.entries.push({
          score: job.orderingKey,
          job: {
            header: {
              tenantId: job.descriptor.tenantId,
              lane: job.descriptor.lane,
              scopeParts:
                job.descriptor.scope.kind === "partition"
                  ? job.descriptor.scope.parts
                  : [],
              aggregateId: job.aggregateId,
              eventType: job.eventType,
              eventId: job.eventId,
              sequence: lane.sequence,
              attempt: 0,
              costBytes: job.costBytes,
            },
            body: job.body,
          },
        });
        lane.entries.sort((a, b) => a.score - b.score);
      }
      return Promise.resolve();
    },

    claim(request: ClaimRequest) {
      const now = clock.now();
      for (const lane of lanes.values()) {
        if (lane.leasedBy !== null) continue;
        if (lane.parked !== null) continue;
        if (lane.readyAt > now) continue;
        if (lane.entries.length === 0) continue;

        const jobs: Job[] = [];
        let bytes = 0;
        while (lane.entries.length > 0 && jobs.length < request.maxJobs) {
          const next = lane.entries[0];
          if (next === undefined) break;
          if (
            jobs.length > 0 &&
            bytes + next.job.header.costBytes > request.maxBytes
          )
            break;
          lane.entries.shift();
          bytes += next.job.header.costBytes;
          jobs.push(next.job);
        }
        if (jobs.length === 0) continue;

        leaseCounter += 1;
        const token = `lease-${leaseCounter}`;
        lane.leasedBy = token;
        const groupKey =
          [...lanes].find(([, value]) => value === lane)?.[0] ?? "";
        const batch: ClaimedBatch = {
          lease: { groupKey, token },
          lane: lane.lane,
          tenantId: lane.tenantId,
          jobs,
        };
        return Promise.resolve(batch);
      }
      return Promise.resolve(null);
    },

    settle(lease: Lease) {
      const lane = lanes.get(lease.groupKey);
      if (lane && lane.leasedBy === lease.token) {
        lane.leasedBy = null;
        lane.failures = 0;
      }
      return Promise.resolve();
    },

    retry(lease: Lease, afterMs: number) {
      const lane = lanes.get(lease.groupKey);
      if (lane && lane.leasedBy === lease.token) {
        lane.leasedBy = null;
        lane.failures += 1;
        lane.readyAt = clock.now() + afterMs;
      }
      return Promise.resolve();
    },

    park(lease: Lease, reason: string) {
      const lane = lanes.get(lease.groupKey);
      if (lane && lane.leasedBy === lease.token) {
        lane.leasedBy = null;
        lane.parked = reason;
      }
      return Promise.resolve();
    },

    depth(groupKey: string) {
      return Promise.resolve(lanes.get(groupKey)?.entries.length ?? 0);
    },
  };
}

export function memorySpool(): BlobSpool & { readonly size: number } {
  const blobs = new Map<string, string>();
  let counter = 0;
  return {
    get size() {
      return blobs.size;
    },
    put(tenantId, body) {
      counter += 1;
      const ref = `${tenantId}/blob-${counter}`;
      blobs.set(ref, body);
      return Promise.resolve(ref);
    },
    get: (ref) => Promise.resolve(blobs.get(ref) ?? null),
    release(ref) {
      blobs.delete(ref);
      return Promise.resolve();
    },
  };
}

export class RevisionConflictError extends Error {
  constructor(readonly key: ProcessInstanceKey) {
    super(
      `process instance revision conflict for ${key.processName}/${key.processKey}`,
    );
    this.name = "RevisionConflictError";
  }
}

interface MemoryInstance extends StoredProcessState {
  readonly key: ProcessInstanceKey;
  readonly nextWakeAt: number | null;
}

export function memoryProcessStore(): ProcessStore & {
  poison(key: ProcessInstanceKey, raw: unknown): void;
} {
  const instances = new Map<string, MemoryInstance>();
  const id = (key: ProcessInstanceKey) =>
    `${key.processName}${key.projectId}${key.processKey}`;

  return {
    poison(key, raw) {
      instances.set(id(key), {
        key,
        state: raw,
        revision: 1,
        stateVersion: "poisoned",
        tenantId: "",
        nextWakeAt: null,
      });
    },
    load: (key) => Promise.resolve(instances.get(id(key)) ?? null),
    save({ key, tenantId, state, stateVersion, expectedRevision, nextWakeAt }) {
      const current = instances.get(id(key));
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision)
        throw new RevisionConflictError(key);
      instances.set(id(key), {
        key,
        state,
        stateVersion,
        revision: currentRevision + 1,
        tenantId,
        nextWakeAt,
      });
      return Promise.resolve();
    },
    due(now, limit) {
      const due: DueProcessInstance[] = [];
      for (const instance of instances.values()) {
        if (due.length >= limit) break;
        if (instance.nextWakeAt === null || instance.nextWakeAt > now) continue;
        due.push({
          ...instance.key,
          tenantId: instance.tenantId,
          nextWakeAt: instance.nextWakeAt,
        });
      }
      return Promise.resolve(due);
    },
  };
}

interface MemoryOutboxRow extends OutboxRow {
  leasedUntil: number;
  settledAt: number | null;
  dead: boolean;
  readyAt: number;
  readonly processName: string;
}

export interface MemoryOutbox extends Outbox {
  readonly rows: readonly MemoryOutboxRow[];
  dead(): readonly MemoryOutboxRow[];
}

export function memoryOutbox(clock: Clock): MemoryOutbox {
  const rows: MemoryOutboxRow[] = [];
  let counter = 0;
  return {
    get rows() {
      return rows;
    },
    dead: () => rows.filter((row) => row.dead),

    stage(staged) {
      for (const row of staged) {
        // messageKey collapses redeliveries of one logical intent.
        if (
          rows.some(
            (existing) =>
              existing.messageKey === row.messageKey && !existing.dead,
          )
        ) {
          continue;
        }
        counter += 1;
        rows.push({
          ...row,
          id: `outbox-${counter}`,
          attempt: 0,
          leasedUntil: 0,
          settledAt: null,
          dead: false,
          readyAt: 0,
          processName: row.intentType.split("/")[0] ?? "",
        });
      }
      return Promise.resolve();
    },

    claim(limit, leaseMs) {
      const now = clock.now();
      const claimed = rows
        .filter(
          (row) =>
            row.settledAt === null &&
            !row.dead &&
            row.leasedUntil <= now &&
            row.readyAt <= now,
        )
        .slice(0, limit);
      for (const row of claimed) row.leasedUntil = now + leaseMs;
      return Promise.resolve(claimed);
    },

    settle(id) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.settledAt = clock.now();
      return Promise.resolve();
    },

    fail(id, retryable, afterMs) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return Promise.resolve();
      row.attempt += 1;
      row.leasedUntil = 0;
      if (retryable) row.readyAt = clock.now() + afterMs;
      else row.dead = true;
      return Promise.resolve();
    },

    prune(processName, before) {
      let removed = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row === undefined) continue;
        if (row.processName !== processName) continue;
        if (row.settledAt === null || row.settledAt >= before) continue;
        rows.splice(index, 1);
        removed += 1;
      }
      return Promise.resolve(removed);
    },
  };
}
