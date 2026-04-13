import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ZodType, z } from "zod";

// ---------------------------------------------------------------------------
// SSE configuration
// ---------------------------------------------------------------------------

/**
 * Configuration object for SSE endpoints registered via `v.sse()`.
 *
 * Each event type is declared with a Zod schema. The framework validates
 * event data against the schema before sending.
 */
export interface SSEConfig<
  TEvents extends Record<string, ZodType>,
  TInput extends ZodType = ZodType,
  TQuery extends ZodType = ZodType,
> {
  /** Map of event names to their payload schemas. */
  events: TEvents;
  /** Optional JSON body schema (for POST-based SSE). */
  input?: TInput;
  /** Optional query string schema. */
  query?: TQuery;
  /** OpenAPI description. */
  description?: string;

  // -- per-endpoint options (same as EndpointConfig) -------------------------
  auth?: "default" | "none";
  resourceLimit?: string;
  middleware?: Array<(c: Context, next: () => Promise<void>) => Promise<void | Response>>;
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
export type SSEHandler<TApp, TEvents extends Record<string, ZodType>, TConfig> = (
  c: Context,
  args: {
    input: TConfig extends { input: ZodType } ? z.infer<TConfig["input"]> : never;
    query: TConfig extends { query: ZodType } ? z.infer<TConfig["query"]> : never;
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
 * @param c       - Hono context
 * @param events  - Map of event names to Zod schemas (for validation)
 * @param handler - Callback that receives the typed stream
 * @returns A streaming Response
 */
export function createSSEResponse<TEvents extends Record<string, ZodType>>(
  c: Context,
  events: TEvents,
  handler: (stream: TypedSSEStream<TEvents>) => void | Promise<void>,
): Response {
  return streamSSE(c, async (sseStream) => {
    const typedStream: TypedSSEStream<TEvents> = {
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
            return;
          }
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

    await handler(typedStream);
  }) as unknown as Response;
}
