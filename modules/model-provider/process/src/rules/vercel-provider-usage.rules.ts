import type { GatewayProviderUsage } from "@langwatch/gateway-contract";
import type { wrapLanguageModel } from "ai";

/** A provider model the middleware can wrap; `ai` re-exports no name for it. */
export type MeterableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
/** The usage one answered call reports. */
export type ProviderCallUsage = Awaited<ReturnType<MeterableModel["doGenerate"]>>["usage"];
/** One part of a streamed answer. */
export type ProviderStreamPart =
  Awaited<ReturnType<MeterableModel["doStream"]>>["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

/** The token quantities a chat call reports, as the ledger names them. */
type ChatCallQuantities = Required<
  Pick<
    GatewayProviderUsage["usage"],
    | "input_tokens"
    | "output_tokens"
    | "cache_read_input_tokens"
    | "cache_creation_input_tokens"
    | "reasoning_tokens"
  >
>;

/** The ledger quantities of one answered call: input counts only the uncached prompt (ADR-193). */
export function vercelSpendUsageOf(usage: ProviderCallUsage | undefined): ChatCallQuantities {
  if (!usage) return NO_QUANTITIES;
  const cacheRead = usage.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
  const total = usage.inputTokens.total ?? 0;
  const uncached = usage.inputTokens.noCache ?? total - cacheRead - cacheWrite;
  const isConsistent = uncached >= 0;
  const quantities = {
    input_tokens: isConsistent ? uncached : total,
    output_tokens: usage.outputTokens.total ?? 0,
    cache_read_input_tokens: isConsistent ? cacheRead : 0,
    cache_creation_input_tokens: isConsistent ? cacheWrite : 0,
    reasoning_tokens: usage.outputTokens.reasoning ?? 0,
  };
  return quantities;
}

/** Whether the call billed anything; a zero answer writes no ledger row. */
export function isBilledUsage(quantities: ChatCallQuantities): boolean {
  return Object.values(quantities).some((quantity) => quantity > 0);
}

const NO_QUANTITIES: ChatCallQuantities = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_tokens: 0,
};
