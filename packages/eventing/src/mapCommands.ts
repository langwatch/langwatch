import type { EventSourcedQueueProcessor, QueueSendOptions } from "./queues/index.ts";

/** Convert pipeline command dispatchers to plain async functions. */
export type MappedCommand<P> = {
  (data: P, options?: QueueSendOptions<P>): Promise<void>;
  sendBatch?: (data: P[], options?: QueueSendOptions<P>) => Promise<void>;
};

export type MapCommands<Payloads extends Record<string, Record<string, unknown>>> = {
  [K in keyof Payloads]: MappedCommand<Payloads[K]>;
};

function mapCommand<P extends Record<string, unknown>>(
  processor: EventSourcedQueueProcessor<P>,
): MappedCommand<P> {
  return Object.assign((data: P, options?: QueueSendOptions<P>) => processor.send(data, options), {
    sendBatch: (data: P[], options?: QueueSendOptions<P>) => processor.sendBatch(data, options),
  });
}

export function mapCommands<Payloads extends Record<string, Record<string, unknown>>>(commands: {
  [K in keyof Payloads]: EventSourcedQueueProcessor<Payloads[K]>;
}): MapCommands<Payloads> {
  const result: Partial<MapCommands<Payloads>> = {};
  for (const name in commands) {
    result[name] = mapCommand(commands[name]);
  }
  return result as MapCommands<Payloads>;
}
