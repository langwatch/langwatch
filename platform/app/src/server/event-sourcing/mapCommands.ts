import type { EventSourcedQueueProcessor, QueueSendOptions } from "./queues";

/** Convert pipeline command dispatchers to plain async functions. */
export type MappedCommand<P> = {
  (data: P, options?: QueueSendOptions<P>): Promise<void>;
  sendBatch?: (data: P[], options?: QueueSendOptions<P>) => Promise<void>;
};

export type MapCommands<
  T extends Record<string, EventSourcedQueueProcessor<any>>,
> = {
  [K in keyof T]: T[K] extends EventSourcedQueueProcessor<infer P>
    ? MappedCommand<P>
    : never;
};

export function mapCommands<
  T extends Record<string, EventSourcedQueueProcessor<any>>,
>(commands: T): MapCommands<T> {
  const result = {} as Record<string, MappedCommand<any>>;
  for (const [name, processor] of Object.entries(commands)) {
    const command = ((data, options) =>
      processor.send(data, options)) as MappedCommand<any>;
    command.sendBatch = (data, options) => processor.sendBatch(data, options);
    result[name] = command;
  }
  return result as MapCommands<T>;
}
