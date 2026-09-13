/**
 * What Trace builds for itself, from the process members it declared it reads
 * and its own config.
 *
 * Before this file the collaborators arrived as a `{ trace: { ... } }` bag a
 * hand-written composition handed to the installer. `withModules` resolves
 * `members` against the fourteen keys of `ProcessMembers` and nothing else, so
 * that bag can no longer reach a module and the module builds its own.
 *
 * The api is Trace's PRODUCER role: it ingests, spools, stages commands on the
 * `trace_processing` pipeline and reads. Everything the processing pipeline
 * owns - the fold projections, the rename command, the v1 S3 spool and the
 * process's broadcast fabric - keeps the absence branch the deleted api
 * composition gave it, refusing by name rather than answering emptily.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing, FoldProjectionStore } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { TraceLegacyFilterConditions } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type {
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "../repositories/trace-clickhouse-client.repository.ts";
import { TraceCanonicalisationService } from "../services/canonicalisers/trace-canonicalisation.service.ts";
import { TraceBlobStoreService } from "../services/offload/trace-blob-store.service.ts";
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
}>;

/** Builds this process's Trace collaborators from its members and config. */
export function buildTraceCollaborators(input: {
  members: TraceBuildMembers;
  config: TraceBuildConfig;
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
    commands: buildTraceProducerCommands({
      eventing: members.eventing,
      processName: config.processName,
    }),
    broadcast: refusingBroadcast(refuse),
    fallbackVisibilityDays: config.fallbackVisibilityDays,
    processName: config.processName,
    ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
  };
}

/**
 * Registers the `trace_processing` pipeline this process produces to, and
 * publishes its three senders.
 *
 * `changeTraceName` is NOT one of them: the rename is the processing role's
 * command, and a producer that staged it would write an event no consumer on
 * this process folds. It refuses by name, which is what the api answered
 * before this module composed itself.
 */
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
  if (!isSender(add) || !isSender(remove) || !isSender(recordSpan)) {
    throw new Error(
      'The trace_processing registration produced no "addAnnotation", "removeAnnotation" and "recordSpan" command senders; the pipeline was registered incompletely.',
    );
  }
  const refuse = refusalFactory(input.processName);

  return {
    recordSpan: (data) => recordSpan.send(data),
    addAnnotation: (data) => add.send(data),
    removeAnnotation: (data) => remove.send(data),
    changeTraceName: () => Promise.reject(refuse("the trace rename command")),
  };
}

/**
 * The routed ClickHouse member, adapted to the low-level client Trace's
 * repositories ask for. One tenant per resolution, exactly as the tables' own
 * rule requires: every statement names its tenant.
 */
class MemberTraceClickHouseClient implements TraceClickHouseWriteClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json<T = Row>(): Promise<T[]> }> {
    const result = await this.clickhouse.query<Row>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async <T = Row>() => result.rows as unknown as T[] };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values as readonly Record<string, unknown>[],
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
  }
}

/**
 * The member, as the tenant-keyed resolver every Trace repository takes.
 *
 * The cast is the one seam where Trace's own narrow client meets a parameter
 * still declared as the vendor's `ClickHouseClient`; the deleted composition
 * cast at the same seam, for the same reason - the repositories call `query`
 * and `insert` and nothing else on it.
 */
function memberClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): (tenantId: string) => Promise<ClickHouseClient> {
  const resolve: TraceClickHouseWriteResolver = (tenantId) =>
    Promise.resolve(new MemberTraceClickHouseClient(clickhouse, tenantId));
  return resolve as unknown as (tenantId: string) => Promise<ClickHouseClient>;
}

/**
 * The process's broadcast fabric, absent.
 *
 * Both live-update subscriptions stream off a tenant emitter the PROCESS owns
 * and a redis fan-out writes into. No member carries one and Trace declares no
 * presence peer, so a subscription refuses by name here rather than handing
 * back an in-process emitter nothing would ever publish to - which would read
 * to a browser as a project with no new traces.
 */
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

/** A capability this deployment did not compose, refused by name at the call. */
class TraceCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "TraceCapabilityUnavailableError";
  }
}

function refusalFactory(processName: string) {
  return (capability: string) => new TraceCapabilityUnavailableError(processName, capability);
}
