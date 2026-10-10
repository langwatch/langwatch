import { toEpochMs } from "@langwatch/time";
import { z } from "zod";

/** Zod schema that accepts either an epoch number or a valid ISO date string. */
export const flexibleDateSchema = z.union([
  z.number(),
  z.string().refine((val) => !Number.isNaN(toEpochMs(val)), {
    message: "Invalid date format",
  }),
]);
