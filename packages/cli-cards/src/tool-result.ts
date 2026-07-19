/**
 * The value Langy transports for a successful CLI call.
 *
 * This is deliberately a discriminated union rather than an untagged JSON
 * document. The command boundary validates the payload once, then the event
 * log, Redis live edge and browser can carry the same typed value without each
 * layer guessing whether `{ value: "..." }` is traces, analytics, or neither.
 */
import * as z from "zod/v4";
import {
  datasetCardSchema,
  evalRunCardSchema,
  metricsCardSchema,
  promptDiffCardSchema,
  resourceCardSchema,
  scenarioCardSchema,
  traceCardSchema,
  tracesCardSchema,
} from "./cards.js";
import { cardKindFor } from "./registry.js";

const cardResult = <Kind extends string, Schema extends z.ZodType>(
  card: Kind,
  payload: Schema,
) => z.object({ kind: z.literal("card"), card: z.literal(card), payload });

const cliCardResultSchema = z.discriminatedUnion("card", [
  cardResult("traces", tracesCardSchema),
  cardResult("trace", traceCardSchema),
  cardResult("metrics", metricsCardSchema),
  cardResult("evalRun", evalRunCardSchema),
  cardResult("dataset", datasetCardSchema),
  cardResult("scenario", scenarioCardSchema),
  cardResult("promptDiff", promptDiffCardSchema),
  cardResult("resourceRead", resourceCardSchema),
  cardResult("resourceCreated", resourceCardSchema),
  cardResult("resourceUpdated", resourceCardSchema),
  cardResult("resourceRemoved", resourceCardSchema),
]);

export const cliToolResultSchema = z.union([
  cliCardResultSchema,
  z.object({ kind: z.literal("json"), payload: z.json() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

export type CliToolResult = z.infer<typeof cliToolResultSchema>;

/** The payload rendered by a card, without the transport discriminator. */
export function cliToolResultPayload(result: CliToolResult): unknown {
  return result.kind === "card" || result.kind === "json"
    ? result.payload
    : result.text;
}

/**
 * Normalize every successful CLI JSON response. A command-specific card is the
 * rich variant; a valid JSON response which has no card yet is still a typed
 * `json` receipt. That is how adding a CLI command cannot punch a hole in the
 * transport contract.
 */
export function toCliToolResult({
  resource,
  verb,
  payload,
}: {
  resource: string;
  verb: string;
  payload: unknown;
}): CliToolResult {
  const card = cardKindFor({ resource, verb });
  const schemaByCard = {
    traces: tracesCardSchema,
    trace: traceCardSchema,
    metrics: metricsCardSchema,
    evalRun: evalRunCardSchema,
    dataset: datasetCardSchema,
    scenario: scenarioCardSchema,
    promptDiff: promptDiffCardSchema,
    resourceRead: resourceCardSchema,
    resourceCreated: resourceCardSchema,
    resourceUpdated: resourceCardSchema,
    resourceRemoved: resourceCardSchema,
  } as const;
  const parsed = schemaByCard[card].safeParse(payload);
  if (parsed.success) {
    return { kind: "card", card, payload: parsed.data } as CliToolResult;
  }
  return { kind: "json", payload: z.json().parse(payload) };
}

/** Normalize successful non-JSON stdout without pretending it is structured. */
export function toCliTextResult(text: string): CliToolResult {
  return { kind: "text", text };
}

/** Read a serialized result from storage/live transport without throwing. */
export function parseCliToolResult(value: unknown): CliToolResult | null {
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  const parsed = cliToolResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
