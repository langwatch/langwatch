import type { Named } from "@langwatch/module";
import { z } from "zod";

export const QUARANTINE_DEFAULT_WINDOW_SECONDS = 60;
export const QUARANTINE_DEFAULT_THRESHOLD = 100;

const quarantineFillInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    windowSeconds: z.number().positive().default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
    threshold: z.number().nonnegative().default(QUARANTINE_DEFAULT_THRESHOLD),
  })
  .strict();
export interface QuarantineFillInputSchema extends Named<
  typeof quarantineFillInputSchemaDefinition
> {}
export const quarantineFillInputSchema: QuarantineFillInputSchema =
  quarantineFillInputSchemaDefinition;
export type QuarantineFillInput = z.input<typeof quarantineFillInputSchema>;

const quarantineFillStatsSchemaDefinition = z
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
export interface QuarantineFillStatsSchema extends Named<
  typeof quarantineFillStatsSchemaDefinition
> {}
export const quarantineFillStatsSchema: QuarantineFillStatsSchema =
  quarantineFillStatsSchemaDefinition;
export type QuarantineFillStats = z.infer<typeof quarantineFillStatsSchema>;
