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
  dashboardCardSchema,
  datasetCardSchema,
  evalRunCardSchema,
  evaluatorConfigCardSchema,
  metricsCardSchema,
  timeseriesCardSchema,
  promptDiffCardSchema,
  resourceCardSchema,
  scenarioCardSchema,
  simulationRunCardSchema,
  simulationSetRunCardSchema,
  spendCardSchema,
  traceCardSchema,
  tracesCardSchema,
  SCHEMA_BY_CARD_KIND,
} from "./schemas.js";
import { CARD_PROBES, cardKindFor, promoteCard } from "./registry.js";

/**
 * The card's own verdict on whether the thing it describes actually happened.
 *
 * Absent means settled — which is what every stored result already means, so
 * this is additive and old turns keep rendering exactly as before. `unconfirmed`
 * is set only where the payload cannot substantiate the card's claim (today:
 * a `create` whose result names no created resource), and it is what stops the
 * panel from reaching a success render on nothing at all.
 */
export const CLI_CARD_OUTCOMES = ["unconfirmed"] as const;

export type CliCardOutcome = (typeof CLI_CARD_OUTCOMES)[number];

const cardResult = <Kind extends string, Schema extends z.ZodType>(
  card: Kind,
  payload: Schema,
) =>
  z.object({
    kind: z.literal("card"),
    card: z.literal(card),
    payload,
    outcome: z.enum(CLI_CARD_OUTCOMES).optional(),
  });

const cliCardResultSchema = z.discriminatedUnion("card", [
  cardResult("traces", tracesCardSchema),
  cardResult("trace", traceCardSchema),
  cardResult("metrics", metricsCardSchema),
  cardResult("timeseries", timeseriesCardSchema),
  cardResult("evalRun", evalRunCardSchema),
  cardResult("dataset", datasetCardSchema),
  cardResult("scenario", scenarioCardSchema),
  cardResult("simulationRun", simulationRunCardSchema),
  cardResult("simulationSetRun", simulationSetRunCardSchema),
  cardResult("promptDiff", promptDiffCardSchema),
  cardResult("spend", spendCardSchema),
  cardResult("evaluatorConfig", evaluatorConfigCardSchema),
  cardResult("dashboard", dashboardCardSchema),
  cardResult("resourceRead", resourceCardSchema),
  // The TRANSPORT stays permissive here while `SCHEMA_BY_CARD_KIND` does not:
  // a create that named nothing still has to survive storage and replay so the
  // panel can render it as unconfirmed. Its `outcome` carries that verdict.
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
  // The name is the PRIOR; the payload's own shape may promote it to a richer
  // card, but only from a generic one and never over a deliberate `byVerb`
  // binding. See promotion.ts and ADR-059.
  const nominal = cardKindFor({ resource, verb });
  const card =
    promoteCard({ nominal, payload, probes: CARD_PROBES }) ?? nominal;
  // One map, the shared one. A second copy here drifted from the schemas the
  // rest of the contract reads by, which is how a create card could accept a
  // payload `parseCliResult` refuses.
  const parsed = SCHEMA_BY_CARD_KIND[card].safeParse(payload);
  if (parsed.success) {
    return { kind: "card", card, payload: parsed.data } as CliToolResult;
  }

  // A create whose result names nothing created is still a create — the panel
  // has to SAY the outcome is unconfirmed, and it cannot say anything if the
  // call is demoted to an anonymous JSON receipt. So the card survives and
  // carries the verdict with it. See `namesCreatedResource`.
  if (card === "resourceCreated" && resourceCardSchema.safeParse(payload).success) {
    return {
      kind: "card",
      card,
      payload,
      outcome: "unconfirmed",
    } as CliToolResult;
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
