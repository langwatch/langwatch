import { Config, isSaas, type ConfigOf } from "@langwatch/config";
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

/** One organization's own bounds, keyed by organization id
 * (specs/security/read-rate-limits.feature). */
const requestBoundsByOrganizationSchema = z
  .string()
  .optional()
  .transform((raw) => (raw ? (JSON.parse(raw) as unknown) : undefined))
  .pipe(z.record(z.string(), z.record(z.string(), z.number().int().positive())).optional());

export const entitlementConfig = Config.define((c) => ({
  requestBounds: c.env("LANGWATCH_REQUEST_BOUNDS", requestBoundsSchema),
  requestBoundsByOrganization: c.env(
    "LANGWATCH_REQUEST_BOUNDS_BY_ORGANIZATION",
    requestBoundsByOrganizationSchema,
  ),
  /** The shared leaf: Cloud reads plans from billing's subscriptions; an install, its licence. */
  isSaas,
}));

export type EntitlementConfig = ConfigOf<typeof entitlementConfig>;
