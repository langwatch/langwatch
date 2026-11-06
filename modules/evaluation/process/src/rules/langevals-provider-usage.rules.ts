/**
 * The provider usage a langevals response reports, summed per model, as the gateway ledger
 * entries it becomes (ADR-193). A malformed or absent block is no usage, never a failed call.
 */
import type { GatewayProviderUsage } from "@langwatch/gateway-contract";
import { z } from "zod";

const quantity = z.number().int().min(0).catch(0);

const langevalsModelUsageSchema = z.object({
  model: z.string().min(1),
  input_tokens: quantity,
  output_tokens: quantity,
  cache_read_input_tokens: quantity,
  cache_creation_input_tokens: quantity,
  reasoning_tokens: quantity,
});

const langevalsUsageBlockSchema = z.array(z.unknown()).catch([]);

/** The `usage` of one evaluator result or clustering answer, read defensively. */
export function langevalsProviderUsagesOf({
  usage,
  projectId,
  requestType,
  requestKey,
  occurredAt,
  durationMs,
}: {
  usage: unknown;
  projectId: string;
  requestType: string;
  /** Names the call; the ledger keeps one row per key and model, so a repeat adds nothing. */
  requestKey: string;
  occurredAt: number;
  durationMs: number;
}): GatewayProviderUsage[] {
  return langevalsUsageBlockSchema.parse(usage).flatMap((entry) => {
    const parsed = langevalsModelUsageSchema.safeParse(entry);
    if (!parsed.success) return [];
    const { model, ...quantities } = parsed.data;
    if (Object.values(quantities).every((value) => value === 0)) return [];
    return [
      {
        requestId: `${requestType}:${requestKey}:${model}`,
        projectId,
        model,
        requestType,
        usage: quantities,
        durationMs: Math.max(0, Math.round(durationMs)),
        occurredAt,
      },
    ];
  });
}
