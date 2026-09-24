import type { LitellmPriceEntry } from "../rules/litellm-audio-prices.rules.ts";

/** Why litellm's price registry could not be read this run. */
export type LitellmPriceUnavailableReason = "transport_failed" | "http_status" | "malformed_body";

export type LitellmPriceRegistry =
  | { outcome: "fetched"; prices: Record<string, LitellmPriceEntry> }
  | { outcome: "unavailable"; reason: LitellmPriceUnavailableReason; detail: string };

/** litellm's public price registry: the independent source the catalogue sync audits against. */
export abstract class LitellmPriceChannel {
  abstract fetchPriceRegistry(): Promise<LitellmPriceRegistry>;
}
