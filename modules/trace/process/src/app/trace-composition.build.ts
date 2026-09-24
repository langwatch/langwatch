/**
 * Trace's own collaborators, built from process members. The API is the producer
 * role; pipeline-owned features (folds, rename, spool) refuse by name when absent.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing, FoldProjectionStore } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { TraceCapabilityUnavailableError, type TraceSummaryData } from "@langwatch/trace-contract";

import { MemberTraceClickHouseClientRepository } from "../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import type { TraceLegacyFilterConditions } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type { TraceSpanDedupRepository } from "../repositories/trace-span-dedup.repository.ts";
import { TRACE_PROCESSING_PIPELINE_NAME } from "../services/eventing.trace-pipeline.service.ts";
import { TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../services/trace-canonicalisation.service.ts";
import { TraceProcessingProducerAdapter } from "../services/trace-processing-producer.service.ts";
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
  eventing: EventSourcing;
  logger: Logger;
}>;

/** The config slice the deployment states for this module. */
export type TraceBuildConfig = Readonly<{
  processName: string;
  fallbackVisibilityDays: number;
  publicBaseUrl?: string | undefined;
  /** Whether THIS process registers the trace_processing pipeline. True (default)
   * is producer (API); false defers to install phase which registers the complete
   * definition including subscribers and fold projections. */
  registersProcessingPipeline: boolean;
}>;

/** Builds this process's Trace collaborators from its members and config. */
export function buildTraceCollaborators(input: {
  members: TraceBuildMembers;
  config: TraceBuildConfig;
  dedup: TraceSpanDedupRepository;
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
    commands: config.registersProcessingPipeline
      ? buildTraceProducerCommands({
          eventing: members.eventing,
          processName: config.processName,
        })
      : buildTraceProcessRegistrationCommands({
          eventing: members.eventing,
          processName: config.processName,
        }),
    broadcast: refusingBroadcast(refuse),
    dedup: input.dedup,
    fallbackVisibilityDays: config.fallbackVisibilityDays,
    processName: config.processName,
    ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
  };
}

/** Registers the trace_processing pipeline and publishes three senders.
 * changeTraceName is not included: it's the processing role's command, and a
 * producer would write an event no consumer on this process folds. */
export function buildTraceProducerCommands(input: {
  eventing: EventSourcing;
  processName: string;
}): TraceProcessingCommands {
  const registered = input.eventing.register(
    TraceProcessingProducerAdapter.createTraceProcessingProducerPipeline({
      processName: input.processName,
    }),
  );
  const commands = registered.commands as Record<string, unknown>;
  const add = commands.addAnnotation;
  const remove = commands.removeAnnotation;
  const recordSpan = commands.recordSpan;
  const registrationError = new Error(
    'The trace_processing registration produced no "addAnnotation", "removeAnnotation" and "recordSpan" command senders; the pipeline was registered incompletely.',
  );
  if (!isSender(add)) throw registrationError;
  if (!isSender(remove)) throw registrationError;
  if (!isSender(recordSpan)) throw registrationError;
  const refuse = refusalFactory(input.processName);

  return {
    recordSpan: (data) => recordSpan.send(data),
    addAnnotation: (data) => add.send(data),
    removeAnnotation: (data) => remove.send(data),
    changeTraceName: () => Promise.reject(refuse("the trace rename command")),
  };
}

/** Senders of a trace_processing registration this process does not make
 * itself, resolved at first send (not composition) so they can be looked up on
 * the process's own registration after install phase registers the definition. */
export function buildTraceProcessRegistrationCommands(input: {
  eventing: EventSourcing;
  processName: string;
}): TraceProcessingCommands {
  const refuse = refusalFactory(input.processName);
  const sender = (name: string): CommandSender => {
    // Throws by name when nothing has registered the pipeline yet - a caller
    // that reaches trace before the install phase is a composition-order bug
    // and says so, rather than dropping the command.
    const registered = input.eventing.getPipeline(TRACE_PROCESSING_PIPELINE_NAME);
    const command = (registered.commands as Record<string, unknown>)[name];
    if (!isSender(command)) {
      throw refuse(`the trace_processing "${name}" command`);
    }
    return command;
  };

  // Async, so a resolution failure REJECTS rather than throwing into the
  // caller's synchronous frame: every one of these is declared to return a
  // promise, and an ingest path that catches its command rejection would
  // otherwise be unwound by a composition-order bug it could have reported.
  return {
    recordSpan: async (data) => sender("recordSpan").send(data),
    addAnnotation: async (data) => sender("addAnnotation").send(data),
    removeAnnotation: async (data) => sender("removeAnnotation").send(data),
    changeTraceName: async (data) => sender("changeTraceName").send(data),
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

/** The one shape a command sender has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

function refusalFactory(
  processName: string,
): (capability: string) => TraceCapabilityUnavailableError {
  return (capability: string) => new TraceCapabilityUnavailableError(processName, capability);
}
