export { EventSourcedQueueProcessorMemory } from "./memory.ts";
export type {
  DeduplicationConfig,
  DeduplicationStrategy,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  EventSourcedQueueProcessorOptions,
  JobDelivery,
  ListedWork,
  QueueSendOptions,
} from "./queue.types.ts";
export { resolveDeduplicationStrategy } from "./queue.types.ts";
