import { EventSourcing, mapCommands, type EventSourcedQueueProcessor } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  DatasetNormalizationWorkerPort,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import type { AssignTopicCommandData, ResolveOriginCommandData } from "@langwatch/trace-contract";
import { EventingTraceTopicAssignmentPort } from "./eventing.trace-topic.adapter";
import {
  createDeferredOriginHandler,
  DEFERRED_ORIGIN_CHECK_DELAY_MS,
  type DeferredOriginPayload,
  makeDeferredOriginJobId,
  TraceDeferredOriginSchedulerPort,
} from "./eventing.deferred-origin.adapter";
import { TraceProcessingPipelinePort } from "../ports/trace-processing-pipeline.port";
import { TraceProcessingInstallerPort } from "../ports/trace-processing-installer.port";
import { TraceTopicAssignmentCommandPort } from "../ports/trace-topic-assignment-command.port";

const logger = createLogger("langwatch:trace-processing:installer");

class DeferredOriginScheduler extends TraceDeferredOriginSchedulerPort {
  private sender: ((payload: DeferredOriginPayload) => Promise<void>) | undefined;

  setSender(sender: (payload: DeferredOriginPayload) => Promise<void>): void {
    this.sender = sender;
  }

  schedule(payload: DeferredOriginPayload): Promise<void> {
    if (!this.sender) {
      throw new Error("Trace deferred-origin queue has not been registered.");
    }
    return this.sender(payload);
  }
}

class RegisteredTraceTopicCommand extends TraceTopicAssignmentCommandPort {
  static create(
    command: EventSourcedQueueProcessor<AssignTopicCommandData>,
  ): RegisteredTraceTopicCommand {
    return new RegisteredTraceTopicCommand(command);
  }

  private constructor(
    private readonly command: EventSourcedQueueProcessor<AssignTopicCommandData>,
  ) {
    super();
  }

  async sendAssignTopic(input: AssignTopicCommandData): Promise<void> {
    await this.command.send(input);
  }
}

/**
 * Registers Trace's complete processing definition and its durable auxiliary
 * jobs. The process root supplies the fully composed definition and Dataset
 * worker capability; the installer owns registration order and queue names.
 */
export class TraceProcessingServerInstaller extends TraceProcessingInstallerPort {
  static create(options: {
    pipeline: TraceProcessingPipelinePort;
    datasetNormalization: DatasetNormalizationWorkerPort;
  }): TraceProcessingServerInstaller {
    return new TraceProcessingServerInstaller(options.pipeline, options.datasetNormalization);
  }

  private installed = false;

  private constructor(
    private readonly pipelineDefinition: TraceProcessingPipelinePort,
    private readonly datasetNormalization: DatasetNormalizationWorkerPort,
  ) {
    super();
  }

  install(eventSourcing: EventSourcing) {
    if (this.installed) {
      throw new Error("Trace processing pipeline is already installed in this process.");
    }

    const deferredOrigins = new DeferredOriginScheduler();
    const pipeline = eventSourcing.register(this.pipelineDefinition.build({ deferredOrigins }));
    const resolveOrigin = pipeline.commands.resolveOrigin;
    const assignTopic = pipeline.commands.assignTopic;
    if (!resolveOrigin || !assignTopic) {
      throw new Error(
        "Trace processing pipeline must register resolveOrigin and assignTopic commands.",
      );
    }

    const deferredOriginHandler = createDeferredOriginHandler((input: ResolveOriginCommandData) =>
      resolveOrigin.send(input),
    );
    const deferredOriginQueue = pipeline.service.registerJob<DeferredOriginPayload>({
      name: "deferredOriginResolution",
      process: deferredOriginHandler,
      delay: DEFERRED_ORIGIN_CHECK_DELAY_MS,
      deduplication: {
        makeId: makeDeferredOriginJobId,
        ttlMs: DEFERRED_ORIGIN_CHECK_DELAY_MS + 60_000,
        extend: false,
        replace: false,
      },
      groupKeyFn: (payload) => payload.traceId,
      spanAttributes: (payload) => ({
        "deferred.tenant_id": payload.tenantId,
        "deferred.trace_id": payload.traceId,
      }),
    });
    if (deferredOriginQueue) {
      deferredOrigins.setSender((payload) => deferredOriginQueue.send(payload));
    } else {
      deferredOrigins.setSender(
        createInMemoryDeferredOriginFallback({
          process: deferredOriginHandler,
        }),
      );
    }

    const datasetNormalizeQueue = pipeline.service.registerJob<DatasetNormalizePayload>({
      name: "datasetNormalize",
      process: (payload) => this.datasetNormalization.process(payload),
      groupKeyFn: (payload) => payload.datasetId,
    });
    if (datasetNormalizeQueue) {
      this.datasetNormalization.connect((payload) => datasetNormalizeQueue.send(payload));
    }

    const commands = mapCommands(pipeline.commands);
    const traceAssignments = EventingTraceTopicAssignmentPort.create(
      RegisteredTraceTopicCommand.create(assignTopic),
    );
    this.installed = true;
    return { pipeline, commands, traceAssignments };
  }
}

function createInMemoryDeferredOriginFallback(options: {
  process(payload: DeferredOriginPayload): Promise<void>;
}): (payload: DeferredOriginPayload) => Promise<void> {
  const pending = new Map<string, NodeJS.Timeout>();
  return async (payload) => {
    const id = makeDeferredOriginJobId(payload);
    if (pending.has(id)) return;

    const timer = setTimeout(async () => {
      pending.delete(id);
      try {
        await options.process(payload);
      } catch (error) {
        logger.error(
          { tenantId: payload.tenantId, traceId: payload.traceId, error },
          "Deferred origin resolution failed",
        );
      }
    }, DEFERRED_ORIGIN_CHECK_DELAY_MS);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    pending.set(id, timer);
  };
}
