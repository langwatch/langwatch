import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** Boot overrides for the request-bounds registry (`@langwatch/plans`); key
 * and tier spelling are checked there, not by this shape leaf. */
const requestBoundsSchema = z
  .string()
  .optional()
  .transform((raw) => (raw ? (JSON.parse(raw) as unknown) : undefined))
  .pipe(
    z
      .record(
        z.string(),
        z.union([z.number().int().positive(), z.record(z.string(), z.number().int().positive())]),
      )
      .optional(),
  );

export const entitlementConfig = Config.define((c) => ({
  requestBounds: c.env("LANGWATCH_REQUEST_BOUNDS", requestBoundsSchema),
}));

export type EntitlementConfig = ConfigOf<typeof entitlementConfig>;
