/**
 * Trace's own collaborators, built from process members; pipeline-owned features
 * (folds, rename, spool) refuse by name when absent.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { TraceCapabilityUnavailableError, type TraceSummaryData } from "@langwatch/trace-contract";

import { MemberTraceClickHouseClientRepository } from "../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import type { TraceLegacyFilterConditions } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type { TraceSpanDedupRepository } from "../repositories/trace-span-dedup.repository.ts";
import { TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../services/trace-canonicalisation.service.ts";
import type { TracesTrpcEmitters } from "./trace.app.ts";
import type { TraceProcessingCommands } from "./trace.members.ts";

/**
 * The collaborators one process composes Trace's read graph over. Every
 * optional field is one the producer role does not compose; each has a named
 * refusal rather than a silent empty answer.
 */
export type TraceCollaborators = Readonly<{
  resolveClickHouseClient?: (tenantId: string) => Promise<ClickHouseClient>;
  canonicalisation: TraceCanonicalisationService;
  blobStore: TraceBlobStoreService;
  summaryStore?: FoldProjectionStore<TraceSummaryData>;
  commands: TraceProcessingCommands;
  broadcast: TracesTrpcEmitters;
  filterConditions?: TraceLegacyFilterConditions;
  fallbackVisibilityDays: number;
  processName: string;
  publicBaseUrl?: string;
  /** The ingestion doors' duplicate claim, so an SDK's retry is not a second span. */
  dedup: TraceSpanDedupRepository;
}>;

/** Exactly the process members {@link buildTraceCollaborators} reads. */
export type TraceBuildMembers = Readonly<{
  clickhouse: ClickHouseQueryClient;
  logger: Logger;
}>;

/** The config slice the deployment states for this module. */
export type TraceBuildConfig = Readonly<{
  processName: string;
  fallbackVisibilityDays: number;
  publicBaseUrl?: string | undefined;
}>;

/** Builds this process's Trace collaborators from its members and config. */
export function buildTraceCollaborators(input: {
  members: TraceBuildMembers;
  config: TraceBuildConfig;
  dedup: TraceSpanDedupRepository;
  /** trace_processing's senders, bound when the process connects the pipeline. */
  commands: TraceProcessingCommands;
}): TraceCollaborators {
  const { members, config } = input;
  const refuse = refusalFactory(config.processName);
  const resolveClickHouseClient = memberClickHouseResolver(members.clickhouse);

  return {
    resolveClickHouseClient,
    canonicalisation: TraceCanonicalisationService.create(),
    blobStore: TraceBlobStoreService.create({
      // The v1 spool predates this deployment: a ref written before the
      // stored-object registry existed reads back through S3 directly, and
      // this process composes no such client. `resolveOffloadedTraces`
      // swallows the refusal per field, so such a value keeps its preview
      // rather than failing the whole read.
      resolveS3Client: () => Promise.reject(refuse("a v1 spool object read")),
      resolveClickHouseClient,
      logger: members.logger,
    }),
    // This process folds no trace projections; the summary read comes off the
    // ClickHouse row rather than a fold store.
    commands: input.commands,
    broadcast: refusingBroadcast(refuse),
    dedup: input.dedup,
    fallbackVisibilityDays: config.fallbackVisibilityDays,
    processName: config.processName,
    ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
  };
}

function memberClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): (tenantId: string) => Promise<ClickHouseClient> {
  const resolve = MemberTraceClickHouseClientRepository.resolverFor(clickhouse);
  return resolve as unknown as (tenantId: string) => Promise<ClickHouseClient>;
}

/** The process's broadcast fabric, absent. Subscriptions refuse by name since
 * no member carries a tenant emitter and Trace declares no presence peer. */
function refusingBroadcast(refuse: (capability: string) => Error): TracesTrpcEmitters {
  return {
    getTenantEmitter: () => {
      throw refuse("the trace live-update broadcast");
    },
    cleanupTenantEmitter: () => void 0,
  };
}

/**
 * A stand-in for a capability this process did not compose: every member
 * refuses by name, naming the process that reached it.
 */
export function traceRefusalProxy<T>(processName: string, capability: string): T {
  const refuse = refusalFactory(processName);
  return new Proxy(
    {},
    {
      get: () => () => {
        throw refuse(capability);
      },
      has: () => true,
    },
  ) as T;
}

function refusalFactory(
  processName: string,
): (capability: string) => TraceCapabilityUnavailableError {
  return (capability: string) => new TraceCapabilityUnavailableError(processName, capability);
}
