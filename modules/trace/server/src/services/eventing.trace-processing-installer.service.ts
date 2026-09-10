import { TraceDeferredOriginEventingAdapter } from "./eventing.deferred-origin.service.ts";
import { EventSourcing, mapCommands, type EventSourcedQueueProcessor } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  DatasetNormalizationWorker,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import type { AssignTopicCommandData, ResolveOriginCommandData } from "@langwatch/trace-contract";
import { EventingTraceTopicAssignment } from "./eventing.trace-topic-assignment.service.ts";
import { DEFERRED_ORIGIN_CHECK_DELAY_MS } from "./eventing.deferred-origin.service.ts";
import type { DeferredOriginPayload, TraceDeferredOriginScheduler } from "../app/trace.members.ts";
import { TraceProcessingPipeline } from "../app/trace.members.ts";
import { TraceProcessingInstaller } from "../app/trace.members.ts";
import { TraceTopicAssignmentCommand } from "../app/trace.members.ts";

const logger = createLogger("langwatch:trace-processing:installer");

class DeferredOriginScheduler implements TraceDeferredOriginScheduler {
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

class RegisteredTraceTopicCommand implements TraceTopicAssignmentCommand {
  static create(
    command: EventSourcedQueueProcessor<AssignTopicCommandData>,
  ): RegisteredTraceTopicCommand {
    return new RegisteredTraceTopicCommand(command);
  }

  private constructor(
    private readonly command: EventSourcedQueueProcessor<AssignTopicCommandData>,
  ) {
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
export class TraceProcessingServerInstallerAdapter implements TraceProcessingInstaller {
  static create(options: {
    pipeline: TraceProcessingPipeline;
    datasetNormalization: DatasetNormalizationWorker;
  }): TraceProcessingServerInstallerAdapter {
    return new TraceProcessingServerInstallerAdapter(
      options.pipeline,
      options.datasetNormalization,
    );
  }

  private installed = false;

  private constructor(
    private readonly pipelineDefinition: TraceProcessingPipeline,
    private readonly datasetNormalization: DatasetNormalizationWorker,
  ) {
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

    const deferredOriginHandler = TraceDeferredOriginEventingAdapter.createDeferredOriginHandler(
      (input: ResolveOriginCommandData) => resolveOrigin.send(input),
    );
    const deferredOriginQueue = pipeline.service.registerJob<DeferredOriginPayload>({
      name: "deferredOriginResolution",
      process: deferredOriginHandler,
      delay: DEFERRED_ORIGIN_CHECK_DELAY_MS,
      deduplication: {
        makeId: TraceDeferredOriginEventingAdapter.makeDeferredOriginJobId,
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
    const traceAssignments = EventingTraceTopicAssignment.create(
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
    const id = TraceDeferredOriginEventingAdapter.makeDeferredOriginJobId(payload);
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
