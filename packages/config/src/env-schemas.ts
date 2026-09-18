import { z } from "zod";

/**
 * How this codebase reads an environment spelling. Shared so two owners reading
 * "the same switch" cannot disagree on what counts as on — the divergence these
 * replace was a SaaS install silently counting no billable events.
 */
export const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

export const environmentBooleanSchema = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((value) => value === true || value === "true" || value === "1");

/** A switch that accepts the literal `1` or `true`, in any casing. */
export const environmentOneOrTrueSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform(
    (value) =>
      value === true ||
      (typeof value === "string" && (value === "1" || value.toLowerCase() === "true")),
  );

/** Legacy flags whose presence, rather than spelling, enables them. */
export const environmentPresenceSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value === true || (typeof value === "string" && value.length > 0));

/** Legacy switches that deliberately opt in only for the literal `1`. */
export const environmentExactOneSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value === true || value === "1");

/** Opt-out controls where only the literal `1` disables a default-on behaviour. */
export const environmentNotExactOneSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value !== "1");

/** Legacy truthiness: `1`, `true` or `yes`, in any casing. */
export const environmentLegacyTruthySchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform(
    (value) => value === true || (typeof value === "string" && /^(1|true|yes)$/i.test(value)),
  );

/** An env-string as a positive safe integer, or `undefined` when it isn't one. */
export function positiveSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The same, accepting `0`, for budgets and caps where zero means "unbounded"
 * or "off" and a negative is still nonsense.
 */
export function nonNegativeSafeIntegerOrUndefined(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
