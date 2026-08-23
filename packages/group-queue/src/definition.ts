import type {
  GroupQueueDefinition,
  GroupQueuePayloadSchema,
} from "./contracts";

export function defineGroupQueue<
  Payload extends Record<string, unknown>,
  const Name extends string,
>(options: {
  name: Name;
  payload: GroupQueuePayloadSchema<Payload>;
  groupBy: (payload: Payload) => string;
  identify: (payload: Payload) => string;
  score?: (payload: Payload) => number;
  spanAttributes?: GroupQueueDefinition<Payload>["spanAttributes"];
  delay?: number;
  deduplication?: GroupQueueDefinition<Payload>["deduplication"];
  coalescing?: GroupQueueDefinition<Payload>["coalescing"];
}): GroupQueueDefinition<Payload, Name> {
  const name = options.name.trim();
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(name)) {
    throw new Error(
      `Group Queue name "${options.name}" must use letters, numbers, slash, underscore or hyphen`,
    );
  }
  if (typeof options.payload?.parse !== "function") {
    throw new Error("Group Queue requires a payload schema with parse(value)");
  }
  if (typeof options.groupBy !== "function") {
    throw new Error("Group Queue requires a groupBy(payload) rule");
  }
  if (typeof options.identify !== "function") {
    throw new Error("Group Queue requires an identify(payload) rule");
  }
  if (
    options.delay !== undefined &&
    (!Number.isFinite(options.delay) || options.delay < 0)
  ) {
    throw new Error("Group Queue delay must be a non-negative number");
  }

  return Object.freeze({
    ...options,
    deduplication: options.deduplication
      ? Object.freeze({ ...options.deduplication })
      : undefined,
    coalescing: options.coalescing
      ? Object.freeze({ ...options.coalescing })
      : undefined,
    name: name as Name,
    transportName: `{${name}}` as `{${Name}}`,
  });
}
