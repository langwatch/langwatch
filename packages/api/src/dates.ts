/**
 * Date input shapes shared by contract and transport alike: plain Zod plus
 * `@langwatch/time`, nothing else. A REST family and a browser-reachable
 * contract can both depend on this without pulling in the Hono server-
 * transport graph — see `./rest` for the transport half.
 */
import { toEpochMs } from "@langwatch/time";
import { z } from "zod";

/** Zod schema that accepts either an epoch number or a valid ISO date string. */
export const flexibleDateSchema = z.union([
  z.number(),
  z.string().refine((val) => !Number.isNaN(toEpochMs(val)), {
    message: "Invalid date format",
  }),
]);
