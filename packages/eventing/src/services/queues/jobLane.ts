import { z } from "zod";

import type { DeduplicationConfig } from "../../queues/index.ts";
import type { JobDelivery } from "../../queues/queue.types.ts";
import { mapValidationIssues } from "../../utils/errors.ts";
import { QueuedPayloadInvalidError, ValidationError } from "../errorHandling.ts";

type SpanAttributes = Record<string, string | number | boolean>;

/** The reserved envelope field carrying a job's routing, computed at send (ARCHITECTURE §9). */
export const JOB_ROUTING_FIELD = "__routing";

const jobRoutingSchema = z.object({
  groupKey: z.string(),
  score: z.number(),
  coalesceMaxBatch: z.number(),
  dedupId: z.string().optional(),
  spanAttributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** Where a job goes and how it folds, decided from the typed value before it is queued. */
export type JobRouting = z.infer<typeof jobRoutingSchema>;

/** The routing a queued envelope carries; absent on a job queued before routing moved to send. */
export function readJobRouting(envelope: Record<string, unknown>): JobRouting | undefined {
  const parsed = jobRoutingSchema.safeParse(envelope[JOB_ROUTING_FIELD]);
  return parsed.success ? parsed.data : undefined;
}

/** One lane of the shared queue, typed over the payload it parses at the queue boundary. */
export interface JobLane<P> {
  parse: (payload: unknown) => P;
  process: (payload: P, delivery?: JobDelivery) => Promise<void>;
  processBatch?: (payloads: P[], delivery?: JobDelivery) => Promise<void>;
  groupKeyFn: (payload: P) => string;
  getTenantId: (payload: P) => string;
  preflightGroupKey?: (identity: { tenantId: string; aggregateId: string }) => string;
  scoreFn: (payload: P) => number;
  delay?: number;
  deduplication?: DeduplicationConfig<P>;
  spanAttributes?: (payload: P) => SpanAttributes;
  coalesceMaxBatch?: number | ((payload: P) => number);
  /** ADR-066 pillar 2 byte cap for a coalesced batch; undefined takes the GroupQueue default. */
  coalesceMaxBytes?: number;
}

/** The tenant a dequeued payload carries, and the tenant segment of the group it routes to. */
export interface JobTenants {
  readonly payloadTenant: string;
  readonly groupTenant: string;
}

/** A dequeued job read once through its lane's parser. */
export interface ReadJob extends JobTenants {
  readonly run: (delivery?: JobDelivery) => Promise<void>;
}

export interface ReadBatch {
  readonly jobs: readonly JobTenants[];
  readonly run: (delivery?: JobDelivery) => Promise<void>;
}

/** A lane as the global registry holds it: closures over unknown payloads, each parsing once. */
export interface JobRegistryEntry {
  readonly read: (payload: unknown) => ReadJob;
  readonly readBatch?: (payloads: readonly unknown[]) => ReadBatch;
  /** The routing the lane computes for a payload, parsed first; what a send attaches. */
  readonly route: (payload: unknown) => JobRouting;
  readonly preflightGroupKey?: (identity: { tenantId: string; aggregateId: string }) => string;
  readonly coalesceMaxBytes?: number;
}

function tenantsOf<P>(lane: JobLane<P>, payload: P): JobTenants {
  return {
    payloadTenant: lane.getTenantId(payload),
    groupTenant: lane.groupKeyFn(payload).split("/")[0] ?? "",
  };
}

/** A schema refusal read structurally, so either Zod major's error is recognised. */
const schemaRefusalSchema = z.object({
  issues: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number()])),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

/** Parses a dequeued payload; one its schema no longer reads is refused non-retryably, by path. */
function parseDequeued<P>(lane: JobLane<P>, jobPath: string, payload: unknown): P {
  try {
    return lane.parse(payload);
  } catch (error) {
    const refusal = schemaRefusalSchema.safeParse(error);
    if (refusal.success) {
      throw new QueuedPayloadInvalidError({
        jobPath,
        issues: mapValidationIssues(refusal.data.issues),
      });
    }
    if (error instanceof ValidationError) {
      throw new QueuedPayloadInvalidError({
        jobPath,
        issues: [{ path: error.field ?? "", code: "undeclared", message: error.reason }],
      });
    }
    throw error;
  }
}

export function sealJobLane<P>(
  lane: JobLane<P>,
  namespaceDedupId: (id: string) => string,
  jobPath = "job",
): JobRegistryEntry {
  const processBatch = lane.processBatch;
  return {
    read: (payload) => {
      const parsed = parseDequeued(lane, jobPath, payload);
      return { ...tenantsOf(lane, parsed), run: (delivery) => lane.process(parsed, delivery) };
    },
    readBatch: processBatch
      ? (payloads) => {
          const parsed = payloads.map((payload) => parseDequeued(lane, jobPath, payload));
          return {
            jobs: parsed.map((payload) => tenantsOf(lane, payload)),
            run: (delivery) => processBatch(parsed, delivery),
          };
        }
      : undefined,
    route: (payload) =>
      routeJob({
        lane,
        payload: lane.parse(payload),
        deduplication: lane.deduplication,
        namespaceDedupId,
      }),
    preflightGroupKey: lane.preflightGroupKey,
    coalesceMaxBytes: lane.coalesceMaxBytes,
  };
}

export function routeJob<P>({
  lane,
  payload,
  deduplication,
  namespaceDedupId,
}: {
  lane: JobLane<P>;
  payload: P;
  deduplication: DeduplicationConfig<P> | undefined;
  namespaceDedupId: (id: string) => string;
}): JobRouting {
  const coalesce = lane.coalesceMaxBatch;
  return {
    groupKey: lane.groupKeyFn(payload),
    score: lane.scoreFn(payload),
    coalesceMaxBatch: typeof coalesce === "function" ? coalesce(payload) : (coalesce ?? 1),
    ...(deduplication ? { dedupId: namespaceDedupId(deduplication.makeId(payload)) } : {}),
    ...spanAttributesOf(lane, payload),
  };
}

/** A lane's span attributes; a throwing reader costs the attributes, never the send. */
function spanAttributesOf<P>(lane: JobLane<P>, payload: P): { spanAttributes?: SpanAttributes } {
  if (!lane.spanAttributes) return {};
  try {
    return { spanAttributes: lane.spanAttributes(payload) };
  } catch {
    return {};
  }
}

/** A payload's own fields as a record, ready to carry routing metadata beside them. */
export function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) record[key] = field;
  return record;
}
