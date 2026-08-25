import { z } from "zod";

export const QUARANTINE_DEFAULT_WINDOW_SECONDS = 60;
export const QUARANTINE_DEFAULT_THRESHOLD = 100;

export const quarantineFillInputSchema = z
  .object({
    organizationId: z.string().min(1),
    windowSeconds: z.number().positive().default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
    threshold: z.number().nonnegative().default(QUARANTINE_DEFAULT_THRESHOLD),
  })
  .strict();
export type QuarantineFillInput = z.input<typeof quarantineFillInputSchema>;

export const quarantineFillStatsSchema = z
  .object({
    windowSeconds: z.number().positive(),
    threshold: z.number().nonnegative(),
    spanCount: z.number().int().nonnegative(),
    rate: z.number().nonnegative(),
    exceeded: z.boolean(),
    perSource: z.array(
      z
        .object({
          ingestionSourceId: z.string().min(1),
          spanCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type QuarantineFillStats = z.infer<typeof quarantineFillStatsSchema>;

export abstract class GovernanceQuarantineFillService {
  abstract evaluate(input: QuarantineFillInput): Promise<QuarantineFillStats>;
}
