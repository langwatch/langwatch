import { EventSourcingPipeline } from "./pipeline";

export { EventSourcingPipeline };

export type { EventSourcingConfig } from "./config";
export { createEventSourcingConfig } from "./config";
export { DisabledPipeline, DisabledPipelineBuilder } from "./disabledPipeline";
export type { EventSourcing } from "./eventSourcing";
export { eventSourcing } from "./eventSourcing";

export {
  EventSourcingRuntime,
  getEventSourcingRuntime,
  resetEventSourcingRuntime,
} from "./eventSourcingRuntime";
export type {
  EventSourcingPipelineDefinition,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types";
export type { PipelineBuilderOptions } from "./pipeline/builder";
export { PipelineBuilder } from "./pipeline/builder";
export type { PipelineMetadata } from "./pipeline/types";
export {
  BullmqQueueProcessorFactory,
  DefaultQueueProcessorFactory,
  defaultQueueProcessorFactory,
  EventSourcedQueueProcessorBullmq,
  EventSourcedQueueProcessorMemory,
  MemoryQueueProcessorFactory,
  type QueueProcessorFactory,
} from "./queue";
