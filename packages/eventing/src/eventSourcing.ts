import type { EventingParticipation } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import { DisabledPipeline } from "./disabledPipeline.ts";
import { createEventCatalogue } from "./domain/definitions.ts";
import type { Event, Projection } from "./domain/types.ts";
import type { KillSwitch } from "./kill-switch/index.ts";
import {
  type SealedPipelineDefinition,
  sealPipelineDefinition,
} from "./pipeline/sealedPipeline.ts";
import type {
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/staticBuilder.types.ts";
import type { PipelineWithCommandHandlers, RegisteredPipeline } from "./pipeline/types.ts";
import type {
  DispatchableMessage,
  IntentHandler,
} from "./process-manager/outbox/outboxDispatcherService.ts";
import { ProcessRuntime } from "./process-manager/processRuntime.ts";
import type { ProcessStore } from "./process-manager/stores/processStore.types.ts";
import { ProjectionRegistry } from "./projections/projectionRegistry.ts";
import type { ReplayMarkerChecker } from "./projections/replayMarkerCheck.ts";
import { DispatchError } from "./queues/dispatchError.ts";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  JobDelivery,
} from "./queues/index.ts";
import { EventSourcedQueueProcessorMemory } from "./queues/memory.ts";
import type { ExecutionTarget, RetentionPolicyResolver } from "./runtime.types.ts";
import { EventSourcingPipeline } from "./runtimePipeline.ts";
import {
  ConfigurationError,
  QueueError,
  QueueTenantMismatchError,
  ValidationError,
} from "./services/errorHandling.ts";
import {
  HANDOFF_PROCESS_NAME,
  handoffLaneKindSchema,
  handoffPayloadSchema,
} from "./services/handoff/failedHandoff.ts";
import { JOB_ROUTING_FIELD, type JobTenants, readJobRouting } from "./services/queues/jobLane.ts";
import type { JobRegistryEntry } from "./services/queues/queueManager.ts";
import type { EventStore } from "./stores/eventStore.types.ts";

const logger = createLogger("langwatch:event-sourcing");

/**
 * Options for constructing an EventSourcing instance.
 */
export interface EventSourcingOptions {
  enabled?: boolean;
  eventStore?: EventStore;
  queueFactory?: (
    definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ) => EventSourcedQueueProcessor<Record<string, unknown>>;
  queueName?: string;
  consumersEnabled?: boolean;
  executionTarget?: ExecutionTarget;
  replayMarkerChecker?: ReplayMarkerChecker;
  retentionPolicyResolver?: RetentionPolicyResolver;
  /**
   * Per-tenant operator stop for every component the registered pipelines
   * mount. Absent means no switch is readable, so every component runs.
   */
  killSwitch?: KillSwitch;
  /** Enables warnings when projections run inline because no shared queue exists. */
  warnWhenProjectionsRunInline?: boolean;
  configureGlobalProjections?: (registry: ProjectionRegistry<Event>) => void;
  /**
   * Durable persistence for `withProcess` declarations (inbox, state, outbox,
   * leases, wakes). Required when registering a pipeline with a process
   * manager; tests/local tools may inject an InMemoryProcessStore.
   */
  processStore?: ProcessStore;
  /**
   * Process manager mode: "run" (default, requires ProcessStore) or "producer-only".
   */
  processManagerMode?: "run" | "producer-only";
  /**
   * Which half of a pipeline the process installing modules on this runtime
   * runs. Absent lets the role decide (api produces, worker consumes), which
   * is what every normal process wants; state it only for one that differs.
   */
  participation?: EventingParticipation;
  /** The runtime's own maintenance pipelines, installed once where the role drains. */
  maintenance?: () => readonly StaticPipelineDefinition<never>[];
}

/**
 * Stores that can be injected for testing or custom configurations.
 */
interface RuntimeStores {
  eventStore: EventStore;
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  processStore?: ProcessStore;
}

/** A registered pipeline as a lookup by name holds it: senders that parse their payload on send. */
interface RegisteredCommandSenders {
  readonly name: string;
  readonly service: { readonly close: () => Promise<void> };
  readonly commands: Record<string, EventSourcedQueueProcessor<Record<string, unknown>>>;
}

/** Type helper to convert registered commands union to a record of queue processors. */
type CommandsToProcessors<Commands extends RegisteredCommand> = {
  [K in Commands as K["name"]]: EventSourcedQueueProcessor<K["payload"] & Record<string, unknown>>;
};

/**
 * Central event sourcing infrastructure: event store, global queue, projection registry.
 * Supports lazy initialization, graceful degradation, and dependency injection.
 */
export class EventSourcing {
  private readonly tracer = getLangWatchTracer("langwatch.event-sourcing.runtime");
  private readonly pipelines = new Map<string, RegisteredCommandSenders>();
  private readonly _definitions: SealedPipelineDefinition[] = [];
  private readonly _described = new Map<string, SealedPipelineDefinition>();
  private readonly projectionRegistry: ProjectionRegistry<Event>;

  // Infrastructure — lazily initialized
  private _eventStore?: EventStore;
  private _globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  private readonly _globalJobRegistry = new Map<string, JobRegistryEntry>();
  private _initialized = false;
  private _consumersHeld = false;
  private _loggedDisabledWarning = false;

  // Options
  private readonly _enabled: boolean;
  private readonly _queueFactory?: EventSourcingOptions["queueFactory"];
  private readonly _queueName: string;
  private readonly _consumersEnabled: boolean;
  private readonly _executionTarget?: ExecutionTarget;
  private readonly _replayMarkerChecker?: ReplayMarkerChecker;
  private readonly _retentionPolicyResolver?: RetentionPolicyResolver;
  private readonly _killSwitch?: KillSwitch;
  private readonly _warnWhenProjectionsRunInline: boolean;
  private readonly _processStore?: ProcessStore;
  private readonly _processManagerMode: "run" | "producer-only";
  private readonly _participation?: EventingParticipation;
  private readonly _maintenance?: () => readonly StaticPipelineDefinition<never>[];
  private _processRuntimeInstance?: ProcessRuntime;
  /** Each registered pipeline's re-drive of its recorded hand-offs, by pipeline name. */
  private readonly handoffRedrives = new Map<
    string,
    (message: DispatchableMessage) => Promise<void>
  >();
  /** The process managers this producer registered and will not run. */
  private readonly _unrunProcessManagers = new Set<string>();

  constructor(options: EventSourcingOptions = {}) {
    this._enabled = options.enabled ?? true;
    this._eventStore = options.eventStore;
    this._queueFactory = options.queueFactory;
    this._queueName = options.queueName ?? "event-sourcing/jobs";
    this._consumersEnabled = options.consumersEnabled ?? true;
    this._executionTarget = options.executionTarget;
    this._replayMarkerChecker = options.replayMarkerChecker;
    this._retentionPolicyResolver = options.retentionPolicyResolver;
    this._killSwitch = options.killSwitch;
    this._warnWhenProjectionsRunInline = options.warnWhenProjectionsRunInline ?? false;
    this._processStore = options.processStore;
    this._processManagerMode = options.processManagerMode ?? "run";
    this._participation = options.participation;
    this._maintenance = options.maintenance;

    this.projectionRegistry = new ProjectionRegistry<Event>({
      parseEvent: (value) => this.parseRegisteredEvent(value),
      start: () => this.startGlobalRegistry(),
    });
    options.configureGlobalProjections?.(this.projectionRegistry);
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * What this runtime states about which half it runs, for the composition
   * installing modules on it. Absent is the normal answer: the role decides.
   */
  get participation(): EventingParticipation | undefined {
    return this._participation;
  }

  /**
   * The durable process state this runtime leases, as composition hands it to
   * a module's declaration. A producer holds none, and says so by answering
   * nothing rather than by throwing the way `processRuntime` does.
   */
  get processStore(): ProcessStore | undefined {
    return this._processStore;
  }

  /**
   * The `withProcessManager` runtime — lazily constructed so an EventSourcing
   * instance with no process declarations pays nothing. Public so the
   * composition root can feed lifecycle envelopes from outside a pipeline.
   */
  get processRuntime(): ProcessRuntime {
    if (this._processManagerMode === "producer-only") {
      throw new ConfigurationError(
        "EventSourcing",
        "This runtime registers pipelines producer-only, so it runs no process managers and has no process runtime. Ask the process that claims the shared queue.",
        { unrunProcessManagers: [...this._unrunProcessManagers] },
      );
    }
    const processStore = this.requireProcessStore();
    if (!this._processRuntimeInstance) {
      this._processRuntimeInstance = new ProcessRuntime({
        store: processStore,
        consumersEnabled: this._consumersEnabled,
        held: this._consumersHeld,
      });
    }
    return this._processRuntimeInstance;
  }

  /**
   * Registers without consuming until `startConsumers()`: a composition holds
   * before its first pipeline, so no job or intent runs against a half-built process.
   */
  holdConsumers(): void {
    this._consumersHeld = true;
  }

  /** Starts the global registry, then the consumer and process runtime a hold kept idle. */
  startConsumers(): void {
    this.startGlobalRegistry();
    if (!this._consumersHeld) return;
    this._consumersHeld = false;
    this._globalQueue?.start?.();
    this._processRuntimeInstance?.start();
  }

  /** The process managers this runtime registered producer-only and will not run. */
  get unrunProcessManagers(): readonly string[] {
    return [...this._unrunProcessManagers];
  }

  get eventStore(): EventStore | undefined {
    this.ensureInitialized();
    return this._eventStore;
  }

  get globalQueue(): EventSourcedQueueProcessor<Record<string, unknown>> | undefined {
    this.ensureInitialized();
    return this._globalQueue;
  }

  get globalJobRegistry(): Map<string, JobRegistryEntry> {
    return this._globalJobRegistry;
  }

  getEventStore<EventType extends Event>(): EventStore<EventType> | undefined {
    return this.eventStore as EventStore<EventType> | undefined;
  }

  /**
   * Retrieves a registered pipeline by name.
   * Throws if the pipeline has not been registered yet.
   */
  getPipeline(name: string): RegisteredCommandSenders {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(
        `Pipeline "${name}" not found. Available: ${Array.from(this.pipelines.keys()).join(", ")}`,
      );
    }
    return pipeline;
  }

  /** The blob and process-manager sweeps this runtime was built with; none if it drains nothing. */
  maintenancePipelines(): readonly StaticPipelineDefinition<never>[] {
    return this._maintenance?.() ?? [];
  }

  /** A queued event parsed with the schema of whichever registered pipeline declares its type. */
  private parseRegisteredEvent(value: unknown): Event {
    const type =
      typeof value === "object" && value !== null && "type" in value ? value.type : undefined;
    const owner = this._definitions.find((definition) =>
      definition.aggregate.events.some((event) => event.type === type),
    );
    if (!owner) {
      throw new ValidationError({
        reason: "No registered pipeline declares this queued event's type",
        field: "type",
      });
    }
    return owner.open((definition): Event => definition.parseEvent(value));
  }

  /**
   * The registered definitions, each replaced by its described consume side when a
   * role that sends only listed it. Read by introspection; nothing here is run.
   */
  get definitions(): readonly SealedPipelineDefinition[] {
    if (this._described.size === 0) return this._definitions;
    const kept = this._definitions.filter(({ metadata }) => !this._described.has(metadata.name));
    return [...kept, ...this._described.values()];
  }

  /** Lists a pipeline's consume side without starting it: no queue, consumer, timer or sender. */
  describe<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>): void {
    this._described.set(definition.metadata.name, sealPipelineDefinition(definition));
  }

  /**
   * Registers a static pipeline definition with the runtime infrastructure.
   * Takes a static definition created with `definePipeline({...})` and connects it
   * to ClickHouse, Redis, and other runtime dependencies.
   */
  register<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand = NoCommands,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    [Commands] extends [NoCommands]
      ? Record<string, EventSourcedQueueProcessor<Record<string, unknown>>>
      : CommandsToProcessors<Commands>
  > {
    return this.tracer.withActiveSpan(
      "EventSourcing.register",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": definition.metadata.name,
          "pipeline.aggregate_type": definition.metadata.aggregateType,
        },
      },
      () => this.registerPipelineInSpan(definition),
    );
  }

  /**
   * Both sides of a same-name collision, described well enough to say which
   * composition to delete — the difference between them is precisely the
   * capability whichever one lost would have taken with it.
   */
  private describeDuplicateRegistration<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(incoming: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>): string {
    const existing = this._definitions.find(
      (registered) => registered.metadata.name === incoming.metadata.name,
    );
    return [
      `Pipeline "${incoming.metadata.name}" is already registered on this runtime.`,
      `Already registered: ${existing ? existing.open((definition) => this.describeDefinition(definition)) : this.describeDefinition(undefined)}.`,
      `Refused: ${this.describeDefinition(incoming)}.`,
      "One runtime registers one pipeline per name - compose exactly one of them in this process.",
    ].join(" ");
  }

  /**
   * Starts routing every global lane once: when consumers start, or at the first dispatch in a
   * runtime that holds none. Every module registers first, so several may declare global
   * projections and peer subscribers, in any order (§9).
   */
  private startGlobalRegistry(): void {
    const registry = this.projectionRegistry;
    if (!registry.hasProjections || registry.isInitialized) return;
    const queue = this.globalQueue;
    if (!queue) return;
    registry.initialize(queue, this._globalJobRegistry, this._executionTarget);
  }

  /** A pipeline's cross-pipeline lanes, before the global registry starts routing. */
  private registerGlobalProjections(
    definition: Pick<StaticPipelineDefinition, "globalProjections" | "metadata">,
  ): void {
    for (const projection of definition.globalProjections ?? []) {
      if (this.projectionRegistry.isInitialized) {
        throw new ConfigurationError(
          "EventSourcing",
          `Pipeline "${definition.metadata.name}" declares the global lane "${projection.name}" after the global registry started routing. Register every pipeline before consumers start or the first event is dispatched.`,
          { pipeline: definition.metadata.name, projection: projection.name },
        );
      }
      projection.register(this.projectionRegistry);
    }
  }

  /** One registration's capabilities, as a line a boot failure can carry. */
  private describeDefinition<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands> | undefined,
  ): string {
    if (!definition) return "an earlier registration this runtime kept no definition for";
    const subscribers =
      definition.foldSubscribers.size +
      definition.mapSubscribers.size +
      definition.eventSubscribers.size;
    const commands = definition.commands.map((command) => command.definition.name).join(", ");
    return (
      `aggregate "${definition.metadata.aggregateType}", ` +
      `${definition.foldProjections.size} fold and ${definition.mapProjections.size} map projections, ` +
      `${subscribers} subscribers, commands [${commands}]`
    );
  }

  /**
   * The body of `register()`, run inside its tracing span. Extracted to a
   * named method so its branching is counted on its own rather than folded
   * into `register`'s complexity.
   */
  private registerPipelineInSpan<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand = NoCommands,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    [Commands] extends [NoCommands]
      ? Record<string, EventSourcedQueueProcessor<Record<string, unknown>>>
      : CommandsToProcessors<Commands>
  > {
    type ReturnType = PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, ProjectionTypes>,
      [Commands] extends [NoCommands]
        ? Record<string, EventSourcedQueueProcessor<Record<string, unknown>>>
        : CommandsToProcessors<Commands>
    >;
    this.assertRegistrable(definition);
    this._definitions.push(sealPipelineDefinition(definition));

    if (!this._enabled || !this.eventStore) {
      logger.warn(
        {
          pipeline: definition.metadata.name,
          isEnabled: this._enabled,
          hasEventStore: !!this.eventStore,
        },
        "Returning DisabledPipeline - commands will be silently dropped",
      );
      this.logDisabledWarning({
        pipeline: definition.metadata.name,
      });
      const disabled = new DisabledPipeline<EventType, ProjectionTypes>(
        definition.metadata.name,
        definition.metadata.aggregateType,
        definition.metadata,
      );
      this.pipelines.set(definition.metadata.name, disabled);
      return disabled as ReturnType;
    }

    const eventStore = this.eventStore as EventStore<EventType>;

    const serviceOptions = buildServiceOptions(definition);

    // Process managers consume their declaring pipeline's committed
    // events directly through generated live subscribers. A producer folds
    // nothing and subscribes to nothing, so it generates neither — the
    // decline above is what says so, once, by name.
    if (definition.processManagers.size > 0 && this._processManagerMode === "run") {
      const artifacts = this.processRuntime.registerPipeline<EventType>({
        pipelineName: definition.metadata.name,
        processManagers: definition.processManagers,
      });
      if (artifacts.subscribers.length > 0) {
        serviceOptions.subscribers = [
          ...(serviceOptions.subscribers ?? []),
          ...artifacts.subscribers,
        ];
      }
    }

    this.registerGlobalProjections(definition);

    // Create the pipeline
    const pipeline = new EventSourcingPipeline<EventType, ProjectionTypes>({
      name: definition.metadata.name,
      aggregateType: definition.metadata.aggregateType,
      allowedEventTypes: definition.aggregate.events.map((event) => event.type),
      eventStore,
      ...serviceOptions,
      globalQueue: this._globalQueue,
      globalJobRegistry: this._globalJobRegistry,
      parseEvent: definition.parseEvent,
      metadata: definition.metadata,
      globalRegistry: this.projectionRegistry,
      handoffStore: this._processStore,
      executionTarget: this._executionTarget,
      replayMarkerChecker: this._replayMarkerChecker,
      retentionPolicyResolver: definition.retentionPolicyResolver ?? this._retentionPolicyResolver,
      killSwitch: this._killSwitch,
      warnWhenProjectionsRunInline: this._warnWhenProjectionsRunInline,
      prepareEventForProjection: definition.prepareEventForProjection,
    });

    this.hostHandoffRedrive({
      pipelineName: definition.metadata.name,
      redeliver: (message) => pipeline.service.redeliverHandoff({ message }),
    });

    // Get command dispatchers
    const commandProcessors = pipeline.service.getCommandQueues();
    const dispatchers = Object.fromEntries(commandProcessors);

    const result: RegisteredPipeline<EventType, ProjectionTypes> & {
      commands: typeof dispatchers;
    } = Object.assign(pipeline, { commands: dispatchers });

    this.pipelines.set(definition.metadata.name, result);
    return result as ReturnType;
  }

  /**
   * Routes each recorded hand-off row to its pipeline's re-drive. One outbox
   * worker serves every pipeline, hosted when the first one registers.
   */
  private hostHandoffRedrive({
    pipelineName,
    redeliver,
  }: {
    pipelineName: string;
    redeliver: (message: DispatchableMessage) => Promise<void>;
  }): void {
    if (!this._processStore || this._processManagerMode !== "run") return;
    this.handoffRedrives.set(pipelineName, redeliver);
    if (this.handoffRedrives.size > 1) return;
    const route: IntentHandler = async ({ message }) => {
      const { pipeline } = handoffPayloadSchema.parse(message.payload);
      const redrive = this.handoffRedrives.get(pipeline);
      if (!redrive) {
        throw new DispatchError({
          message: `Pipeline "${pipeline}" is not registered in this process`,
          retryable: true,
        });
      }
      await redrive(message);
    };
    this.processRuntime.hostOutbox({
      processName: HANDOFF_PROCESS_NAME,
      handlers: Object.fromEntries(handoffLaneKindSchema.options.map((kind) => [kind, route])),
    });
  }

  /**
   * Gracefully closes all pipelines, the projection registry, and the global queue.
   */
  async close(): Promise<void> {
    if (this._processRuntimeInstance) {
      try {
        await this._processRuntimeInstance.stop();
      } catch (error) {
        logger.error({ error }, "Failed to stop process runtime");
      }
    }
    for (const [name, pipeline] of this.pipelines) {
      try {
        await pipeline.service.close();
      } catch (error) {
        logger.error({ pipeline: name, error }, "Failed to close pipeline");
      }
    }
    // Close the global queue after all consumers are shut down
    if (this._globalQueue) {
      await this._globalQueue.close();
    }
    // Close registry AFTER the queue, never before (see ADR-###).
    if (this.projectionRegistry.isInitialized) {
      await this.projectionRegistry.close();
    }
    this.pipelines.clear();
  }

  private ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    if (!this._enabled) {
      logger.info("Event sourcing is disabled (enabled=false)");
      return;
    }

    this.initializeStores();
  }

  /** Refuses, before anything is built, a definition this runtime cannot take. */
  private assertRegistrable<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>): void {
    // One runtime, one registration per pipeline name; collision is fatal at boot.
    if (this.pipelines.has(definition.metadata.name)) {
      throw new Error(this.describeDuplicateRegistration(definition));
    }
    if (definition.processManagers.size > 0) {
      if (this._processManagerMode === "producer-only") {
        this.declineProcessManagers(definition);
      } else {
        this.requireProcessStore();
      }
    }
    try {
      createEventCatalogue([
        ...this._definitions.map((registered) => registered.aggregate),
        definition.aggregate,
      ]);
    } catch (error) {
      const registered = this._definitions.map((existing) => existing.metadata.name).join(", ");
      throw new Error(
        `Registering pipeline "${definition.metadata.name}" failed against the already-registered [${registered}]: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Record that this process declines to run the given process managers.
   */
  private declineProcessManagers<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand,
  >(definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>): void {
    const declined = [...definition.processManagers.keys()].filter(
      (name) => !this._unrunProcessManagers.has(name),
    );
    if (declined.length === 0) return;
    for (const name of declined) this._unrunProcessManagers.add(name);
    logger.info(
      { pipeline: definition.metadata.name, processManagers: declined },
      "Registered producer-only: this process sends commands on the pipeline and does not run its process managers. Their inbox, outbox and wakes belong to the process that claims the shared queue.",
    );
  }

  private requireProcessStore(): ProcessStore {
    if (!this._processStore) {
      throw new ConfigurationError(
        "EventSourcing",
        "A durable ProcessStore is required for process managers. Tests must explicitly inject InMemoryProcessStore.createForTesting(); local development must explicitly inject InMemoryProcessStore.createForLocalDevelopment().",
      );
    }
    return this._processStore;
  }

  /**
   * Strips routing metadata and looks up the registry entry for a job payload,
   * returning null on no handler. Resolution runs several times per job, so a
   * miss logs at debug here; the processing path raises it once, loudly.
   */
  private lookupEntry(
    payload: Record<string, unknown>,
  ): { entry: JobRegistryEntry; clean: Record<string, unknown> } | null {
    const pipelineName = payload.__pipelineName as string;
    const jobType = payload.__jobType as string;
    const jobName = payload.__jobName as string;

    if (!pipelineName || !jobType || !jobName) {
      logger.debug({ pipelineName, jobType, jobName }, "Job payload missing routing metadata");
      return null;
    }

    const registryKey = `${pipelineName}:${jobType}:${jobName}`;
    const entry = this._globalJobRegistry.get(registryKey);
    if (!entry) {
      logger.debug({ registryKey }, "No handler registered for job");
      return null;
    }
    const {
      __pipelineName: _p,
      __jobType: _t,
      __jobName: _n,
      [JOB_ROUTING_FIELD]: _r,
      ...clean
    } = payload;
    return { entry, clean };
  }

  /**
   * The identifying fields of a job payload, for a log line naming WHICH
   * record is at risk. Take whichever key is present (command or event) and
   * nothing else — the rest of the payload is business data.
   */
  private static jobIdentity(payload: Record<string, unknown>): {
    pipelineName: string | null;
    jobType: string | null;
    jobName: string | null;
    tenantId: string | null;
    aggregateType: string | null;
    aggregateId: string | null;
    eventType: string | null;
    gatewayRequestId: string | null;
  } {
    const str = (value: unknown): string | undefined =>
      typeof value === "string" && value.length > 0 ? value : undefined;
    return {
      pipelineName: str(payload.__pipelineName) ?? null,
      jobType: str(payload.__jobType) ?? null,
      jobName: str(payload.__jobName) ?? null,
      tenantId: str(payload.tenantId) ?? null,
      aggregateType: str(payload.aggregateType) ?? null,
      aggregateId: str(payload.aggregateId) ?? null,
      eventType: str(payload.type) ?? null,
      gatewayRequestId: str(payload.gateway_request_id) ?? null,
    };
  }

  /**
   * Refuse a job this worker cannot route: reject for retry, not acknowledge.
   */
  private rejectUnroutableJob(payload: Record<string, unknown>, queueName: string): never {
    const identity = EventSourcing.jobIdentity(payload);
    logger.error(
      identity,
      "No handler registered for this job in this worker; rejecting it for retry rather than dropping it",
    );
    throw new QueueError({
      queueName,
      operation: "process",
      message: "job routing key is not registered in this worker",
      context: identity,
    });
  }

  /**
   * Gate every dispatch on tenant consistency: the payload's tenant (via the
   * lane's recorded accessor) must equal the group-key tenant segment, else
   * the job was misrouted. Refuse non-retryably so the queue dead-letters it.
   */
  private assertTenantRoutingConsistency({
    tenants,
    payload,
    queueName,
  }: {
    tenants: JobTenants;
    payload: Record<string, unknown>;
    queueName: string;
  }): void {
    const { payloadTenant, groupTenant } = tenants;
    if (payloadTenant === groupTenant) return;
    const identity = EventSourcing.jobIdentity(payload);
    logger.error(
      {
        ...identity,
        queueName,
        payloadTenant,
        groupTenant,
        jobPath: `${identity.pipelineName}:${identity.jobType}:${identity.jobName}`,
      },
      "Job payload tenant does not match its group-key tenant; refusing to process so the queue dead-letters it",
    );
    throw new QueueTenantMismatchError({
      queueName,
      payloadTenant,
      groupTenant,
      jobPath: `${identity.pipelineName}:${identity.jobType}:${identity.jobName}`,
    });
  }

  private initializeStores(): void {
    if (!this._eventStore) {
      throw new ConfigurationError(
        "EventSourcing",
        "An EventStore is required. Tests and local development must explicitly inject EventStoreMemory.",
      );
    }

    // Create the ONE global queue
    this.createGlobalQueue();

    logger.info(
      {
        eventStore: this._eventStore?.constructor.name ?? "none",
        queueProcessor: this._globalQueue?.constructor.name ?? "none",
      },
      "Event sourcing runtime initialized",
    );
  }

  private createGlobalQueue(): void {
    const queueName = this._queueName;

    const definition = {
      name: queueName,
      groupKey: (payload: Record<string, unknown>) => this.globalQueueGroupKey(payload),
      score: (payload: Record<string, unknown>) => this.globalQueueScore(payload),
      spanAttributes: (payload: Record<string, unknown>) => this.globalQueueSpanAttributes(payload),
      process: async (payload: Record<string, unknown>, delivery?: JobDelivery) =>
        this.processGlobalQueuePayload(payload, delivery, queueName),
      coalesceMaxBatch: (payload: Record<string, unknown>) =>
        this.globalQueueCoalesceMaxBatch(payload),
      coalesceMaxBytes: (payload: Record<string, unknown>) =>
        this.globalQueueCoalesceMaxBytes(payload),
      onExhausted: (payload: Record<string, unknown>) =>
        readJobRouting(payload)?.onExhausted ?? "block",
      processBatch: async (payloads: Record<string, unknown>[], delivery?: JobDelivery) =>
        this.processGlobalQueueBatch(payloads, delivery, queueName),
    };

    this._globalQueue = this._queueFactory
      ? this._queueFactory(definition)
      : new EventSourcedQueueProcessorMemory(definition);
    if (!this._consumersHeld) this._globalQueue.start?.();
  }

  private globalQueueGroupKey(payload: Record<string, unknown>): string {
    return readJobRouting(payload)?.groupKey ?? "__unknown__";
  }

  private globalQueueScore(payload: Record<string, unknown>): number {
    return readJobRouting(payload)?.score ?? nowInstant().epochMilliseconds;
  }

  private globalQueueSpanAttributes(payload: Record<string, unknown>) {
    return readJobRouting(payload)?.spanAttributes ?? {};
  }

  private async processGlobalQueuePayload(
    payload: Record<string, unknown>,
    delivery: JobDelivery | undefined,
    queueName: string,
  ): Promise<void> {
    const result = this.lookupEntry(payload);
    if (!result) {
      this.rejectUnroutableJob(payload, queueName);
    }
    const job = result.entry.read(result.clean);
    this.assertTenantRoutingConsistency({ tenants: job, payload, queueName });
    // Forward the delivery. Dropping it here silently pinned `deliveryAttempt` at 1 for every
    // registry entry, which disabled the fold store's merge-on-retry handling (#6578).
    await job.run(delivery);
  }

  private globalQueueCoalesceMaxBatch(payload: Record<string, unknown>): number {
    // Decided at send from the typed value; a job queued before routing moved to send folds alone.
    return readJobRouting(payload)?.coalesceMaxBatch ?? 1;
  }

  private globalQueueCoalesceMaxBytes(payload: Record<string, unknown>): number | undefined {
    // undefined falls back to the GroupQueue's DEFAULT_COALESCE_MAX_BYTES.
    return this.lookupEntry(payload)?.entry.coalesceMaxBytes;
  }

  private async processGlobalQueueBatch(
    payloads: Record<string, unknown>[],
    delivery: JobDelivery | undefined,
    queueName: string,
  ): Promise<void> {
    if (payloads.length === 0) return;
    // Reject unroutable payloads upfront so lookupEntry returns only non-null.
    const routed = payloads.map((payload) => {
      const result = this.lookupEntry(payload);
      if (!result) this.rejectUnroutableJob(payload, queueName);
      return { ...result, payload };
    });

    // Every payload is read and tenant-gated before any runs: a misrouted job must never reach
    // its handler, alone or folded into a coalesced batch. A mixed batch (the GroupQueue only
    // coalesces one group, so it should never happen) runs per item.
    const firstEntry = routed[0]?.entry;
    const readBatch = firstEntry?.readBatch;
    if (!readBatch || !routed.every((r) => r.entry === firstEntry)) {
      const jobs = routed.map((r) => {
        const job = r.entry.read(r.clean);
        this.assertTenantRoutingConsistency({ tenants: job, payload: r.payload, queueName });
        return job;
      });
      for (const job of jobs) await job.run(delivery);
      return;
    }

    const batch = readBatch(routed.map((r) => r.clean));
    batch.jobs.forEach((tenants, index) => {
      this.assertTenantRoutingConsistency({
        tenants,
        payload: routed[index]?.payload ?? {},
        queueName,
      });
    });
    // Forward the delivery — see the single-job path (#6578).
    await batch.run(delivery);
  }

  private logDisabledWarning(context: { pipeline?: string; command?: string }): void {
    if (!this._loggedDisabledWarning) {
      logger.warn(context, "Event sourcing is disabled. Operations will be no-ops.");
      this._loggedDisabledWarning = true;
    } else {
      logger.debug(context, "Event sourcing operation ignored (disabled)");
    }
  }

  // ---------------------------------------------------------------------------
  // Test factories
  // ---------------------------------------------------------------------------

  /**
   * Creates an EventSourcing instance for testing with injected stores.
   * Bypasses lazy initialization and env var detection.
   */
  static createForTesting(stores: Partial<RuntimeStores>): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      eventStore: stores.eventStore,
      processStore: stores.processStore,
    });

    // Mark as initialized and inject stores directly
    es._initialized = true;
    es._eventStore = stores.eventStore;
    es._globalQueue = stores.globalQueue;

    return es;
  }

  /**
   * Creates an EventSourcing instance with explicit stores (for integration tests).
   */
  static createWithStores(options: {
    eventStore: EventStore;
    globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
    executionTarget?: ExecutionTarget;
    retentionPolicyResolver?: RetentionPolicyResolver;
    warnWhenProjectionsRunInline?: boolean;
    processStore?: ProcessStore;
  }): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      eventStore: options.eventStore,
      executionTarget: options.executionTarget,
      retentionPolicyResolver: options.retentionPolicyResolver,
      warnWhenProjectionsRunInline: options.warnWhenProjectionsRunInline,
      processStore: options.processStore,
    });

    es._initialized = true;
    es._eventStore = options.eventStore;
    if (options.globalQueue) {
      es._globalQueue = options.globalQueue;
    } else {
      es.createGlobalQueue();
    }

    return es;
  }
}

/**
 * Pure function to convert a StaticPipelineDefinition's Maps/arrays
 * into the flat arrays that EventSourcingPipeline expects.
 */
function buildServiceOptions<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
  Commands extends RegisteredCommand,
>(definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>) {
  // Pass class instances directly — do NOT spread.
  // Getters like `eventTypes` live on the prototype and are lost by `{...obj}`.
  const foldProjections = Array.from(definition.foldProjections.values());
  const stateProjections = Array.from(definition.stateProjections?.values() ?? []);

  const mapProjections = Array.from(definition.mapProjections.values());

  const commandRegistrations = definition.commands.length > 0 ? definition.commands : undefined;

  const foldSubscriberList = Array.from(definition.foldSubscribers.values()).map((entry) => ({
    foldName: entry.projectionName as string,
    definition: entry.definition,
  }));

  const mapSubscriberList = Array.from(definition.mapSubscribers.values()).map((entry) => ({
    mapName: entry.projectionName as string,
    definition: entry.definition,
  }));

  const foldSubscribers = foldSubscriberList.length > 0 ? foldSubscriberList : undefined;
  const mapSubscribers = mapSubscriberList.length > 0 ? mapSubscriberList : undefined;
  const subscribers =
    definition.eventSubscribers.size > 0
      ? Array.from(definition.eventSubscribers.values())
      : undefined;

  return {
    foldProjections: foldProjections.length > 0 ? foldProjections : undefined,
    stateProjections: stateProjections.length > 0 ? stateProjections : undefined,
    mapProjections: mapProjections.length > 0 ? mapProjections : undefined,
    commandRegistrations,
    foldSubscribers,
    mapSubscribers,
    subscribers,
  };
}
