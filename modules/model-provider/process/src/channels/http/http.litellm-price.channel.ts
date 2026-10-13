import { z } from "zod";

import {
  litellmPriceEntrySchema,
  type LitellmPriceEntry,
} from "../../rules/litellm-audio-prices.rules.ts";
import { LitellmPriceChannel, type LitellmPriceRegistry } from "../litellm-price.channel.ts";

const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const priceRegistryBodySchema = z.record(z.string(), z.unknown());

/** Entries that do not match the fields the mapper reads are left out rather than half-read. */
function pickWellFormedEntries(body: Record<string, unknown>): Record<string, LitellmPriceEntry> {
  const prices: Record<string, LitellmPriceEntry> = {};
  for (const [id, raw] of Object.entries(body)) {
    const entry = litellmPriceEntrySchema.safeParse(raw);
    if (entry.success) prices[id] = entry.data;
  }
  return prices;
}

export class HttpLitellmPriceChannel extends LitellmPriceChannel {
  private constructor(private readonly request: typeof fetch) {
    super();
  }

  static create({ request = fetch }: { request?: typeof fetch } = {}): HttpLitellmPriceChannel {
    return new HttpLitellmPriceChannel(request);
  }

  async fetchPriceRegistry(): Promise<LitellmPriceRegistry> {
    let body: unknown;
    try {
      const response = await this.request(LITELLM_PRICES_URL);
      if (!response.ok) {
        return { outcome: "unavailable", reason: "http_status", detail: String(response.status) };
      }
      body = await response.json();
    } catch (error) {
      return {
        outcome: "unavailable",
        reason: "transport_failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const parsed = priceRegistryBodySchema.safeParse(body);
    if (!parsed.success) {
      return { outcome: "unavailable", reason: "malformed_body", detail: parsed.error.message };
    }
    return { outcome: "fetched", prices: pickWellFormedEntries(parsed.data) };
  }
}
