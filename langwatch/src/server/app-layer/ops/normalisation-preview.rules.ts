/**
 * Experimental mapping rules for the Deja View normalisation preview.
 *
 * A rule matches span attributes by key (exact or regex), optionally
 * extracts a piece of the value via a regex capture group, and writes the
 * result to a target attribute key. Rules let operators prototype a new
 * vendor mapping (e.g. "lift gcp.vertex.agent.llm_request contents into
 * gen_ai.input.messages") against real stored events before writing a
 * canonicalisation extractor. They run in-process, read-only, and only
 * inside the preview — never against live ingestion.
 *
 * The shape is deliberately a discriminated block ("match" + "action") so
 * richer action types (e.g. a sandboxed expression DSL) can be added
 * later without breaking stored links or the UI builder.
 */

import { z } from "zod";

/** Bounds keep admin-supplied regexes from turning into a foot-gun. */
export const MAX_RULES = 25;
const MAX_PATTERN_LENGTH = 512;
const MAX_KEY_LENGTH = 512;
/** Longest attribute-value prefix a value regex is executed against. */
const MAX_VALUE_SCAN_LENGTH = 32_768;

export const mappingRuleSchema = z.object({
  match: z.object({
    /** Attribute key to match — exact string, or a regex when keyIsRegex. */
    key: z.string().min(1).max(MAX_KEY_LENGTH),
    keyIsRegex: z.boolean().default(false),
    /**
     * Optional regex run against the (stringified) attribute value. When it
     * has a capture group, group 1 becomes the produced value; otherwise the
     * full match does. Without valuePattern the whole value is carried over.
     */
    valuePattern: z.string().max(MAX_PATTERN_LENGTH).optional(),
  }),
  action: z.object({
    type: z.enum(["copy", "move"]),
    /** Canonical key to write, e.g. gen_ai.input.messages. */
    targetKey: z.string().min(1).max(MAX_KEY_LENGTH),
  }),
});

export const mappingRulesSchema = z
  .array(mappingRuleSchema)
  .max(MAX_RULES)
  .default([]);

export type MappingRule = z.infer<typeof mappingRuleSchema>;

export type MappingRuleResult = {
  ruleIndex: number;
  /** Attribute keys the rule matched, across the span it ran on. */
  matchedKeys: string[];
  producedKey: string | null;
};

export type ApplyMappingRulesResult = {
  attributes: Record<string, unknown>;
  ruleResults: MappingRuleResult[];
};

export class InvalidMappingRuleError extends Error {
  constructor(
    readonly ruleIndex: number,
    readonly field: "match.key" | "match.valuePattern",
    detail: string,
  ) {
    super(`Rule ${ruleIndex + 1}: invalid regex in ${field}: ${detail}`);
    this.name = "InvalidMappingRuleError";
  }
}

/**
 * Compiles every regex in the rule set up front so an invalid pattern
 * rejects the whole run with the offending rule named, instead of failing
 * span-by-span halfway through.
 */
export function compileMappingRules(rules: MappingRule[]): CompiledRule[] {
  return rules.map((rule, index) => {
    let keyRegex: RegExp | null = null;
    if (rule.match.keyIsRegex) {
      try {
        keyRegex = new RegExp(rule.match.key);
      } catch (err) {
        throw new InvalidMappingRuleError(index, "match.key", String(err));
      }
    }

    let valueRegex: RegExp | null = null;
    if (rule.match.valuePattern !== undefined) {
      try {
        valueRegex = new RegExp(rule.match.valuePattern);
      } catch (err) {
        throw new InvalidMappingRuleError(
          index,
          "match.valuePattern",
          String(err),
        );
      }
    }

    return { rule, index, keyRegex, valueRegex };
  });
}

export type CompiledRule = {
  rule: MappingRule;
  index: number;
  keyRegex: RegExp | null;
  valueRegex: RegExp | null;
};

const stringifyValue = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
};

/**
 * Applies compiled rules to one span's attributes. Pure — returns a new
 * attribute map; the input is never mutated. Rules run in order; later
 * rules see the writes (and moves) of earlier ones.
 */
export function applyMappingRules(
  attributes: Record<string, unknown>,
  compiledRules: CompiledRule[],
): ApplyMappingRulesResult {
  const out: Record<string, unknown> = { ...attributes };
  const ruleResults: MappingRuleResult[] = [];

  for (const { rule, index, keyRegex, valueRegex } of compiledRules) {
    const matchedKeys: string[] = [];
    let producedKey: string | null = null;

    const candidateKeys = keyRegex
      ? Object.keys(out).filter((k) => keyRegex.test(k))
      : rule.match.key in out
        ? [rule.match.key]
        : [];

    for (const key of candidateKeys) {
      const rawValue = out[key];
      let produced: unknown = rawValue;

      if (valueRegex) {
        const asString = stringifyValue(rawValue);
        if (asString === null) continue;
        const scanned = asString.slice(0, MAX_VALUE_SCAN_LENGTH);
        const match = valueRegex.exec(scanned);
        if (!match) continue;
        produced = match[1] ?? match[0];
      }

      matchedKeys.push(key);
      out[rule.action.targetKey] = produced;
      producedKey = rule.action.targetKey;
      if (rule.action.type === "move" && key !== rule.action.targetKey) {
        delete out[key];
      }
    }

    ruleResults.push({ ruleIndex: index, matchedKeys, producedKey });
  }

  return { attributes: out, ruleResults };
}
