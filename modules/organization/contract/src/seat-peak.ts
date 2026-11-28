/**
 * The most seats an organization held at once in each calendar month (ADR-002), as our own team
 * reads it at renewal. The customer's pages never read it.
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

/** One calendar month (UTC). A month nobody touched carries the count it began with. */
const organizationSeatPeakMonthSchemaDefinition = z.object({
  /** `YYYY-MM`, UTC. */
  month: z.string(),
  fullPeak: z.number().int().nonnegative(),
  /** Epoch milliseconds the full seat peak was first reached; a carried month's first moment. */
  fullPeakAt: z.number(),
  litePeak: z.number().int().nonnegative(),
  litePeakAt: z.number(),
});
export interface OrganizationSeatPeakMonthSchema extends Named<
  typeof organizationSeatPeakMonthSchemaDefinition
> {}
export const organizationSeatPeakMonthSchema: OrganizationSeatPeakMonthSchema =
  organizationSeatPeakMonthSchemaDefinition;
export type OrganizationSeatPeakMonth = z.infer<typeof organizationSeatPeakMonthSchema>;

/** The seats the plan sells, null when unlimited; developer seats are never capped (ADR-171). */
const seatCapsSchema = z.object({
  fullSeats: z.number().int().nullable(),
  liteSeats: z.number().int().nullable(),
});

const organizationSeatPeakSchemaDefinition = z.discriminatedUnion("counted", [
  /** No opening snapshot yet: nothing is counted, which is not a peak of zero. */
  z.object({ counted: z.literal(false), caps: seatCapsSchema }),
  z.object({
    counted: z.literal(true),
    /** Epoch milliseconds of the opening snapshot. */
    countingSince: z.number(),
    seats: z.object({
      full: z.number().int().nonnegative(),
      lite: z.number().int().nonnegative(),
      developer: z.number().int().nonnegative(),
    }),
    caps: seatCapsSchema,
    /** Every month from the opening to now, newest first. */
    months: z.array(organizationSeatPeakMonthSchema),
    /** Changes whose recorded seat disagreed with the count's: drift, made visible. */
    mismatches: z.number().int().nonnegative(),
  }),
]);
export interface OrganizationSeatPeakSchema extends Named<
  typeof organizationSeatPeakSchemaDefinition
> {}
export const organizationSeatPeakSchema: OrganizationSeatPeakSchema =
  organizationSeatPeakSchemaDefinition;
export type OrganizationSeatPeak = z.infer<typeof organizationSeatPeakSchema>;

/** `organizationSeatPeak.*`: the ops console's read, declared once. */
export const organizationSeatPeakTrpc = defineTrpcContract("organizationSeatPeak")
  .query("get")
  .withInput(z.object({ organizationId: z.string().min(1) }))
  .withOutput(organizationSeatPeakSchema)
  .build();
