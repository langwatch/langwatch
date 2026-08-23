import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";

import {
  parseApiSchema,
  type ApiSchema,
  type ApiSchemaOutput,
} from "./schema.js";
import type { ServiceContext } from "./types.js";

export interface SSECompletion {
  error?: Error;
}

const completions = new WeakMap<Context, Promise<SSECompletion>>();

function createTypedStream<TEvents extends Record<string, ApiSchema>>({
  sseStream,
  events,
}: {
  sseStream: SSEStreamingApi;
  events: TEvents;
}): TypedSSEStream<TEvents> {
  return {
    async emit(event, data) {
      let value: unknown = data;
      const schema = events[event];
      if (schema) {
        const result = await parseApiSchema(schema, data);
        if (!result.success) {
          await sseStream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: `Validation failed for event "${String(event)}"`,
              issues: result.error.issues,
            }),
          });
          throw result.error;
        }
        value = result.data;
      }
      await sseStream.writeSSE({
        event: String(event),
        data: JSON.stringify(value),
      });
    },
    close() {
      sseStream.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Typed SSE stream
// ---------------------------------------------------------------------------

/**
 * A typed wrapper around Hono's SSE streaming API.
 *
 * The `emit` method validates data against the declared event schema before
 * writing to the stream: a non-conforming payload writes an `error` event
 * carrying the issues and rejects, so the handler must catch to continue
 * streaming.
 */
export interface TypedSSEStream<TEvents extends Record<string, ApiSchema>> {
  /** Emit a typed event. Data is validated against the event's Zod schema. */
  emit<K extends string & keyof TEvents>(
    event: K,
    data: ApiSchemaOutput<TEvents[K]>,
  ): Promise<void>;
  /** Close the SSE stream. */
  close(): void;
}

// ---------------------------------------------------------------------------
// SSE handler type
// ---------------------------------------------------------------------------

/**
 * Handler function for SSE endpoints: `(c, stream)` — a stream has no body.
 * Request data arrives through the chain's `withQuery` and is read as the
 * typed context variable `c.get("query")`.
 */
export type SSEHandler<
  TVariables extends Record<string, unknown>,
  TEvents extends Record<string, ApiSchema>,
> = (
  c: ServiceContext<TVariables>,
  stream: TypedSSEStream<TEvents>,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// SSE stream factory
// ---------------------------------------------------------------------------

/**
 * Creates a Hono response that streams SSE events with typed validation.
 *
 * @returns A streaming Response
 */
export function createSSEResponse<TEvents extends Record<string, ApiSchema>>({
  c,
  events,
  handler,
  onError,
}: {
  c: Context;
  events: TEvents;
  handler: (stream: TypedSSEStream<TEvents>) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}): Response {
  let finish!: (result: SSECompletion) => void;
  const completion = new Promise<SSECompletion>((resolve) => {
    finish = resolve;
  });
  completions.set(c, completion);

  return streamSSE(
    c,
    async (sseStream) => {
      sseStream.onAbort(() => finish({}));
      const typedStream = createTypedStream({ sseStream, events });

      try {
        await handler(typedStream);
        finish({});
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error("SSE handler failed", { cause: error });
      }
    },
    async (error) => {
      c.error = error;
      try {
        await onError?.(error);
      } finally {
        finish({ error });
      }
    },
  ) as unknown as Response;
}

/** Returns the current SSE handler lifecycle for request instrumentation. */
export function getSSECompletion(
  c: Context,
): Promise<SSECompletion> | undefined {
  return completions.get(c);
}
