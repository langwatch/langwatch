import {
  defineAggregate,
  defineEvents,
  definePipeline,
  EventSourcing,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  type DatasetNormalizePayload,
  DatasetNormalizationWorkerPort,
} from "@langwatch/dataset-contract";
import { TRACE_PROCESSING_EVENT_TYPES, type TraceProcessingEvent } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventingTraceOriginAdapter } from "../src/adapters/eventing.trace-origin.adapter";
import { type TraceDeferredOriginSchedulerPort } from "../src/adapters/eventing.deferred-origin.adapter";
import { EventingTraceTopicAdapter } from "../src/adapters/eventing.trace-topic.adapter";
import { TraceProcessingServerInstaller } from "../src/adapters/eventing.trace-processing.installer";
import { TraceProcessingPipelinePort } from "../src/ports/trace-processing-pipeline.port";

class TestDatasetNormalization extends DatasetNormalizationWorkerPort {
  readonly process = vi.fn(async (_payload: DatasetNormalizePayload) => {});
  readonly connect = vi.fn();
}

class TestTracePipeline extends TraceProcessingPipelinePort {
  deferredOrigins: TraceDeferredOriginSchedulerPort | undefined;

  build(options: {
    deferredOrigins: TraceDeferredOriginSchedulerPort;
  }): StaticPipelineDefinition<
    TraceProcessingEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
    this.deferredOrigins = options.deferredOrigins;
    return definePipeline<TraceProcessingEvent>({
      name: "trace_processing",
      aggregate: defineAggregate({
        type: "trace",
        events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
      }),
    })
      .withCommand("resolveOrigin", EventingTraceOriginAdapter)
      .withCommand("assignTopic", EventingTraceTopicAdapter)
      .build();
  }
}

function createInstaller(): {
  installer: TraceProcessingServerInstaller;
  datasetNormalization: TestDatasetNormalization;
  pipeline: TestTracePipeline;
} {
  const datasetNormalization = new TestDatasetNormalization();
  const pipeline = new TestTracePipeline();
  return {
    installer: TraceProcessingServerInstaller.create({
      pipeline,
      datasetNormalization,
    }),
    datasetNormalization,
    pipeline,
  };
}

describe("TraceProcessingServerInstaller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers Trace commands and durable jobs with their existing routing names", async () => {
    const eventSourcing = EventSourcing.createWithStores({
      eventStore: EventStoreMemory.createForTesting(),
    });
    const { installer, datasetNormalization } = createInstaller();

    const installed = installer.install(eventSourcing);

    expect(eventSourcing.globalJobRegistry.has("trace_processing:command:assignTopic")).toBe(true);
    expect(
      eventSourcing.globalJobRegistry.has("trace_processing:job:deferredOriginResolution"),
    ).toBe(true);
    expect(eventSourcing.globalJobRegistry.has("trace_processing:job:datasetNormalize")).toBe(true);
    expect(datasetNormalization.connect).toHaveBeenCalledOnce();
    expect(installed.traceAssignments).toBeDefined();

    const datasetJob = eventSourcing.globalJobRegistry.get("trace_processing:job:datasetNormalize");
    await datasetJob?.process({
      id: "upload-1",
      tenantId: "project-1",
      projectId: "project-1",
      datasetId: "dataset-1",
      stagingKey: "staging/upload-1.csv",
      filename: "upload.csv",
    });

    expect(datasetNormalization.process).toHaveBeenCalledOnce();
    expect(datasetNormalization.process).toHaveBeenCalledWith({
      id: "upload-1",
      tenantId: "project-1",
      projectId: "project-1",
      datasetId: "dataset-1",
      stagingKey: "staging/upload-1.csv",
      filename: "upload.csv",
    });
  });

  it("uses the disabled-runtime fallbacks without connecting Dataset to a nonexistent queue", async () => {
    vi.useFakeTimers();
    const eventSourcing = new EventSourcing({ enabled: false });
    const { installer, datasetNormalization, pipeline } = createInstaller();

    expect(() => installer.install(eventSourcing)).not.toThrow();
    expect(datasetNormalization.connect).not.toHaveBeenCalled();
    await expect(
      pipeline.deferredOrigins?.schedule({
        id: "trace-1",
        tenantId: "project-1",
        traceId: "trace-1",
      }),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  });

  it("rejects duplicate installation in one process", () => {
    const eventSourcing = EventSourcing.createWithStores({
      eventStore: EventStoreMemory.createForTesting(),
    });
    const { installer } = createInstaller();

    installer.install(eventSourcing);

    expect(() => installer.install(eventSourcing)).toThrow(
      "Trace processing pipeline is already installed in this process.",
    );
  });
});
