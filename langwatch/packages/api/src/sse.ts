import type { Context, MiddlewareHandler } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { ZodType, z } from "zod";

import type { EndpointConfig } from "./types.js";

export interface SSECompletion {
  error?: Error;
}

const completions = new WeakMap<Context, Promise<SSECompletion>>();

function createTypedStream<TEvents extends Record<string, ZodType>>({
  sseStream,
  events,
}: {
  sseStream: SSEStreamingApi;
  events: TEvents;
}): TypedSSEStream<TEvents> {
  return {
    async emit(event, data) {
      const schema = events[event];
      if (schema) {
        const result = schema.safeParse(data);
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
        data = result.data;
      }
      await sseStream.writeSSE({
        event: String(event),
        data: JSON.stringify(data),
      });
    },
    close() {
      sseStream.close();
    },
  };
}

// ---------------------------------------------------------------------------
// SSE configuration
// ---------------------------------------------------------------------------

/**
 * Configuration object for SSE endpoints registered via `v.sse()`.
 *
 * SSE endpoints are mounted as GET routes and therefore accept query-string
 * input only, not a JSON request body.
 *
 * Each event type is declared with a Zod schema. The framework validates
 * event data against the schema before sending.
 */
export interface SSEConfig<
  TEvents extends Record<string, ZodType>,
  TQuery extends ZodType = ZodType,
> {
  /** Map of event names to their payload schemas. */
  events: TEvents;
  /** Optional query string schema. */
  query?: TQuery;
  /** OpenAPI description. */
  description?: string;

  // -- per-endpoint options (same as EndpointConfig) -------------------------
  auth?: EndpointConfig["auth"];
  resourceLimit?: string;
  middleware?: MiddlewareHandler[];
}

// ---------------------------------------------------------------------------
// Typed SSE stream
// ---------------------------------------------------------------------------

/**
 * A typed wrapper around Hono's SSE streaming API.
 *
 * The `emit` method validates data against the declared event schema before
 * writing to the stream.
 */
export interface TypedSSEStream<TEvents extends Record<string, ZodType>> {
  /** Emit a typed event. Data is validated against the event's Zod schema. */
  emit<K extends string & keyof TEvents>(
    event: K,
    data: z.infer<TEvents[K]>,
  ): Promise<void>;
  /** Close the SSE stream. */
  close(): void;
}

// ---------------------------------------------------------------------------
// SSE handler type
// ---------------------------------------------------------------------------

/**
 * Handler function for SSE endpoints.
 *
 * Receives the Hono context, parsed arguments, and a typed SSE stream.
 */
export type SSEHandler<
  TApp,
  TEvents extends Record<string, ZodType>,
  TConfig,
> = (
  c: Context,
  args: {
    query: TConfig extends { query: ZodType }
      ? z.infer<TConfig["query"]>
      : undefined;
    app: TApp;
  },
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
export function createSSEResponse<TEvents extends Record<string, ZodType>>({
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
