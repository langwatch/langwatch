import {
  REQUEST_BOUND_KEYS,
  REQUEST_BOUND_TIERS,
  type RequestBoundKey,
  type RequestBoundTier,
  type RequestBoundsOverrides,
} from "@langwatch/plans";
import { z } from "zod";

import { Config, RuntimeConfig, type ConfigValue } from "./runtime-config.ts";

const isRequestBoundKey = (key: string): key is RequestBoundKey =>
  (REQUEST_BOUND_KEYS as readonly string[]).includes(key);

const isRequestBoundTier = (tier: string): tier is RequestBoundTier =>
  (REQUEST_BOUND_TIERS as readonly string[]).includes(tier);

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

type MutableTierOverrides = { [Tier in RequestBoundTier]?: number };

/**
 * Parses one `LANGWATCH_REQUEST_BOUNDS` value: a JSON object keyed by
 * registry bound, each entry a positive integer (every tier) or a partial
 * tier record. Bad keys, tiers, values and JSON refuse the boot.
 */
function parseRequestBoundsOverridesJson(
  raw: string,
  ctx: z.RefinementCtx,
): RequestBoundsOverrides {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.addIssue({
      code: "custom",
      message: `LANGWATCH_REQUEST_BOUNDS is not valid JSON: ${reason}.`,
    });
    return z.NEVER;
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    ctx.addIssue({
      code: "custom",
      message: "LANGWATCH_REQUEST_BOUNDS must be a JSON object of bound key to tier overrides.",
    });
    return z.NEVER;
  }

  const overrides: {
    [Key in RequestBoundKey]?: number | MutableTierOverrides;
  } = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (!isRequestBoundKey(key)) {
      ctx.addIssue({ code: "custom", path: [key], message: `Unknown request bound "${key}".` });
      continue;
    }
    if (isPositiveSafeInteger(value)) {
      overrides[key] = value;
      continue;
    }
    const tiers = parseTierOverrides(key, value, ctx);
    if (tiers !== undefined) overrides[key] = tiers;
  }

  return overrides;
}

function parseTierOverrides(
  key: string,
  value: unknown,
  ctx: z.RefinementCtx,
): MutableTierOverrides | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    ctx.addIssue({
      code: "custom",
      path: [key],
      message:
        `Override for "${key}" must be a positive integer or an object with any of ` +
        "the tiers free, paid and enterprise.",
    });
    return void 0;
  }

  const tiers: MutableTierOverrides = {};
  for (const [tier, tierValue] of Object.entries(value)) {
    if (!isRequestBoundTier(tier)) {
      ctx.addIssue({
        code: "custom",
        path: [key, tier],
        message: `Unknown request bound tier "${tier}" for "${key}".`,
      });
      continue;
    }
    if (!isPositiveSafeInteger(tierValue)) {
      ctx.addIssue({
        code: "custom",
        path: [key, tier],
        message: `Override for "${key}" tier "${tier}" must be a positive integer.`,
      });
      continue;
    }
    tiers[tier] = tierValue;
  }

  return tiers;
}

const requestBoundsOverridesSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === "") return void 0;
    return parseRequestBoundsOverridesJson(raw, ctx);
  });

/**
 * Boot overrides for the central request-bounds registry (`@langwatch/plans`),
 * read identically by every process that enforces a bound. Every process
 * projects the raw env leaf through {@link resolveRequestBoundsOverrides}.
 */
export const requestBoundsConfigDefinition = RuntimeConfig.define({
  overrides: Config.value(requestBoundsOverridesSchema, { env: "LANGWATCH_REQUEST_BOUNDS" }),
});

export type RequestBoundsConfig = ConfigValue<typeof requestBoundsConfigDefinition>;

/** The overrides record a process resolved; empty when the deployment named none. */
export function resolveRequestBoundsOverrides(config: RequestBoundsConfig): RequestBoundsOverrides {
  return config.overrides ?? {};
}
