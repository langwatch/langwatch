import type { EventSourcedQueueProcessor } from "./queues";

/** Convert pipeline command dispatchers to plain async functions. */
export type MapCommands<
  T extends Record<string, EventSourcedQueueProcessor<any>>,
> = {
  [K in keyof T]: T[K] extends EventSourcedQueueProcessor<infer P>
    ? (data: P) => Promise<void>
    : never;
};

export function mapCommands<
  T extends Record<string, EventSourcedQueueProcessor<any>>,
>(commands: T): MapCommands<T> {
  const result = {} as Record<string, (data: any) => Promise<void>>;
  for (const [name, processor] of Object.entries(commands)) {
    result[name] = (data) => processor.send(data);
  }
  return result as MapCommands<T>;
}
