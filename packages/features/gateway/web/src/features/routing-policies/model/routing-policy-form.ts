/**
 * The routing-policy form: its schema, and the two mappings between a stored
 * policy and what the drawer edits.
 *
 * Pure. No React, no network, no JSX, so the round trip (stored policy to form
 * values to mutation input) is testable on its own, which is where the
 * interesting bugs live: a policy carrying tier entries mixed into its model
 * name mapping, and restriction lists that are arrays on the wire and
 * newline-separated text in a textarea.
 */
import { z } from "zod";

import { validateModelAliasesAgainstBoundProviders } from "../../../model/virtual-key-alias-validation";
import type { ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { isModelTier, MODEL_TIERS, type ModelTier } from "./model-tier-presets";

/** The four dimensions a restriction rule can target. */
export const RESTRICTION_DIMENSIONS = ["tools", "mcp", "urls", "models"] as const;
export type RestrictionDimension = (typeof RESTRICTION_DIMENSIONS)[number];

const restrictionDimensionSchema = z.object({
  deny: z.string(),
  allow: z.string(),
});

const scopeEntrySchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
  name: z.string().optional(),
});

export const routingPolicyFormSchema = z.object({
  scopes: z.array(scopeEntrySchema).min(1, "Pick where this policy applies"),
  name: z.string().trim().min(1, "Give the policy a name").max(128),
  description: z.string(),
  modelProviderIds: z.array(z.string()).min(1, "Pick at least one model provider"),
  isDefault: z.boolean(),
  /**
   * Per-tier target. An empty string means the tier has no target of its own
   * and falls through to the default model.
   */
  tiers: z.object({
    complex: z.string(),
    reasoning: z.string(),
    fast: z.string(),
  }),
  defaultModel: z.string(),
  nameMappings: z.array(z.object({ from: z.string(), to: z.string() })),
  restrictions: z.object({
    tools: restrictionDimensionSchema,
    mcp: restrictionDimensionSchema,
    urls: restrictionDimensionSchema,
    models: restrictionDimensionSchema,
  }),
});

export type RoutingPolicyFormValues = z.infer<typeof routingPolicyFormSchema>;

/**
 * A fresh empty restriction set every call. The form mutates what it is given,
 * so a shared constant here would let one policy's edits leak into the next
 * drawer that opens.
 */
function emptyRestrictions(): RoutingPolicyFormValues["restrictions"] {
  return {
    tools: { deny: "", allow: "" },
    mcp: { deny: "", allow: "" },
    urls: { deny: "", allow: "" },
    models: { deny: "", allow: "" },
  };
}

export function emptyRoutingPolicyForm(
  scopes: ScopeTriadEntry[] = [],
  isDefault = false,
): RoutingPolicyFormValues {
  return {
    scopes,
    name: "",
    description: "",
    modelProviderIds: [],
    isDefault,
    tiers: { complex: "", reasoning: "", fast: "" },
    defaultModel: "",
    nameMappings: [],
    restrictions: emptyRestrictions(),
  };
}

/** The stored shape this form reads, narrowed to what it actually touches. */
export interface StoredRoutingPolicy {
  name: string;
  description: string | null;
  modelProviderIds: unknown;
  modelAliases: unknown;
  defaultModel: string | null;
  policyRules: unknown;
  isDefault: boolean;
  scopes: Array<{ scopeType: string; scopeId: string }>;
}

export function routingPolicyToFormValues(
  policy: StoredRoutingPolicy,
): RoutingPolicyFormValues {
  const aliases = readStringRecord(policy.modelAliases);
  const tiers = { complex: "", reasoning: "", fast: "" };
  const nameMappings: Array<{ from: string; to: string }> = [];
  for (const [from, to] of Object.entries(aliases)) {
    if (isModelTier(from)) {
      tiers[from] = to;
    } else {
      nameMappings.push({ from, to });
    }
  }

  return {
    scopes: policy.scopes.map((scope) => ({
      scopeType: scope.scopeType as ScopeTriadEntry["scopeType"],
      scopeId: scope.scopeId,
    })),
    name: policy.name,
    description: policy.description ?? "",
    modelProviderIds: readStringArray(policy.modelProviderIds),
    isDefault: policy.isDefault,
    tiers,
    defaultModel: policy.defaultModel ?? "",
    nameMappings,
    restrictions: restrictionsFromStored(policy.policyRules),
  };
}

/**
 * The model name mapping as the gateway will see it: the tiers a policy names
 * a target for, plus every ordinary mapping. A tier left blank is absent, so
 * it falls through to the default model at materialization rather than being
 * pinned to an empty string here.
 */
export function modelAliasesFromForm(
  values: RoutingPolicyFormValues,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const tier of MODEL_TIERS) {
    const target = values.tiers[tier].trim();
    if (target) aliases[tier] = target;
  }
  for (const mapping of values.nameMappings) {
    const from = mapping.from.trim();
    const to = mapping.to.trim();
    if (from && to && !isModelTier(from)) aliases[from] = to;
  }
  return aliases;
}

export function restrictionsToPayload(
  values: RoutingPolicyFormValues,
): Record<RestrictionDimension, { deny: string[]; allow: string[] | null }> {
  const payload = {} as Record<
    RestrictionDimension,
    { deny: string[]; allow: string[] | null }
  >;
  for (const dimension of RESTRICTION_DIMENSIONS) {
    const deny = splitLines(values.restrictions[dimension].deny);
    const allow = splitLines(values.restrictions[dimension].allow);
    payload[dimension] = { deny, allow: allow.length > 0 ? allow : null };
  }
  return payload;
}

/**
 * How many restriction rules are configured, across every dimension. Takes
 * just the restrictions rather than the whole form, so a caller watching only
 * that subtree does not have to fabricate the rest of the values to ask.
 */
export function countRestrictions({
  restrictions,
}: Pick<RoutingPolicyFormValues, "restrictions">): number {
  return RESTRICTION_DIMENSIONS.reduce(
    (total, dimension) =>
      total +
      splitLines(restrictions[dimension].deny).length +
      splitLines(restrictions[dimension].allow).length,
    0,
  );
}

/** How many tiers this policy answers, counting the default-model fallthrough. */
export function countAnsweredTiers(values: RoutingPolicyFormValues): number {
  if (values.defaultModel.trim()) return MODEL_TIERS.length;
  return MODEL_TIERS.filter((tier) => values.tiers[tier].trim()).length;
}

/**
 * Problems worth telling the operator about before they save, rather than
 * letting the first request discover them.
 */
export function validateRoutingPolicyForm({
  values,
  boundProviderTypes,
}: {
  values: RoutingPolicyFormValues;
  boundProviderTypes: ReadonlySet<string>;
}): string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const mapping of values.nameMappings) {
    const from = mapping.from.trim();
    if (!from) continue;
    if (isModelTier(from)) {
      problems.push(
        `"${from}" is a model tier, so it is set in the tier section above rather than as a name mapping.`,
      );
      continue;
    }
    if (seen.has(from)) {
      problems.push(`"${from}" is mapped more than once.`);
    }
    seen.add(from);
  }

  const { errors } = validateModelAliasesAgainstBoundProviders({
    aliases: modelAliasesFromForm(values),
    boundProviderTypes,
  });
  problems.push(...errors);

  return problems;
}

/** Tiers a policy leaves unanswered, so the drawer can say which. */
export function unansweredTiers(values: RoutingPolicyFormValues): ModelTier[] {
  if (values.defaultModel.trim()) return [];
  return MODEL_TIERS.filter((tier) => !values.tiers[tier].trim());
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function restrictionsFromStored(raw: unknown): RoutingPolicyFormValues["restrictions"] {
  const restrictions = emptyRestrictions();
  if (!raw || typeof raw !== "object") return restrictions;
  const source = raw as Record<string, unknown>;
  for (const dimension of RESTRICTION_DIMENSIONS) {
    const stored = source[dimension];
    if (!stored || typeof stored !== "object") continue;
    const { deny, allow } = stored as { deny?: unknown; allow?: unknown };
    restrictions[dimension] = {
      deny: readStringArray(deny).join("\n"),
      allow: readStringArray(allow).join("\n"),
    };
  }
  return restrictions;
}
