import { z } from "zod";

const COST_USD_PATTERN = /^[+-]?\d*(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
const costUsdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const candidate = String(value).trim();
    if (candidate === "" || candidate === "0" || candidate === "0.0")
      return "0";
    if (!COST_USD_PATTERN.test(candidate)) return "0";
    const numeric = Number(candidate);
    return Number.isFinite(numeric) && numeric >= 0 ? candidate : "0";
  })
  .default("0");

export const normalizedPullEventSchema = z
  .object({
    source_event_id: z.string(),
    event_timestamp: z.string(),
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    cost_usd: costUsdSchema,
    tokens_input: z.number().nonnegative().int().default(0),
    tokens_output: z.number().nonnegative().int().default(0),
    raw_payload: z.string(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type NormalizedPullEvent = z.infer<typeof normalizedPullEventSchema>;
export type PullResult = {
  events: NormalizedPullEvent[];
  cursor: string | null;
  errorCount: number;
};
export type PullRunOptions = {
  cursor: string | null;
  credentials?: Record<string, string>;
  context?: { organizationId: string; ingestionSourceId: string };
  deadlineMs?: number;
  signal?: AbortSignal;
};

export abstract class GovernancePuller<Configuration = unknown> {
  abstract readonly id: string;
  abstract validateConfig(config: unknown): Configuration;
  abstract runOnce(
    options: PullRunOptions,
    config: Configuration,
  ): Promise<PullResult>;
}
