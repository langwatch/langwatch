/**
 * Experimental mapping rules for the Deja View normalisation preview.
 *
 * Two rule kinds, both writing to a target attribute key:
 * - "map": match span attributes by key (exact or regex), optionally
 *   extract a piece of the value via a regex capture group, copy/move it.
 * - "expression": a bonsai expression (https://github.com/danfry1/bonsai-js
 *   — safe, sandboxed, no arbitrary JS) evaluated against the span's
 *   canonical attributes. `attr("dotted.key")` reads an attribute; the
 *   whole attribute map is also available as `attrs` for non-dotted
 *   access. Pipes + the strings/arrays/math/types stdlib are enabled.
 *
 * Rules let operators prototype a new vendor mapping against real stored
 * events before writing a canonicalisation extractor. They run
 * in-process, read-only, and only inside the preview — never against
 * live ingestion. Expression rules are the intended long-term direction
 * (eventually all remapping could be authored this way); map rules are
 * the quick regex path.
 */

import { bonsai } from "bonsai-js";
import { arrays, math, strings, types } from "bonsai-js/stdlib";
import { z } from "zod";

/** Bounds keep admin-supplied patterns/expressions from becoming a foot-gun. */
export const MAX_RULES = 25;
const MAX_PATTERN_LENGTH = 512;
const MAX_KEY_LENGTH = 512;
const MAX_EXPRESSION_LENGTH = 4_000;
/** Longest attribute-value prefix a value regex is executed against. */
const MAX_VALUE_SCAN_LENGTH = 32_768;
const EXPRESSION_TIMEOUT_MS = 50;

const targetKeySchema = z.string().min(1).max(MAX_KEY_LENGTH);

export const mapRuleSchema = z.object({
  kind: z.literal("map"),
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
    targetKey: targetKeySchema,
  }),
});

export const expressionRuleSchema = z.object({
  kind: z.literal("expression"),
  /** bonsai expression; its result is written to targetKey (null/undefined = no write). */
  expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
  targetKey: targetKeySchema,
});

export const mappingRuleSchema = z.discriminatedUnion("kind", [
  mapRuleSchema,
  expressionRuleSchema,
]);

export const mappingRulesSchema = z
  .array(mappingRuleSchema)
  .max(MAX_RULES)
  .default([]);

export type MappingRule = z.infer<typeof mappingRuleSchema>;
export type MapRule = z.infer<typeof mapRuleSchema>;
export type ExpressionRule = z.infer<typeof expressionRuleSchema>;

export type MappingRuleWrite = {
  /** Attribute key the value came from; null for expression rules. */
  sourceKey: string | null;
  targetKey: string;
};

export type MappingRuleResult = {
  ruleIndex: number;
  /** Attribute keys the rule matched, across the span it ran on. */
  matchedKeys: string[];
  writes: MappingRuleWrite[];
  /** Runtime evaluation error for this span (expression rules), if any. */
  error: string | null;
};

export type ApplyMappingRulesResult = {
  attributes: Record<string, unknown>;
  ruleResults: MappingRuleResult[];
};

export class InvalidMappingRuleError extends Error {
  constructor(
    readonly ruleIndex: number,
    readonly field: "match.key" | "match.valuePattern" | "expression",
    detail: string,
  ) {
    super(`Rule ${ruleIndex + 1}: invalid ${field}: ${detail}`);
    this.name = "InvalidMappingRuleError";
  }
}

/**
 * One sandboxed evaluator, shared for parse-validation and evaluation.
 * `attr` resolves against a per-evaluation attribute map (set right
 * before each evaluateSync call — evaluation is synchronous so there is
 * no interleaving).
 */
let currentAttrs: Record<string, unknown> = {};
const evaluator = bonsai({
  timeout: EXPRESSION_TIMEOUT_MS,
  maxDepth: 30,
})
  .use(strings)
  .use(arrays)
  .use(math)
  .use(types);
evaluator.addFunction("attr", (key: unknown) =>
  typeof key === "string" ? currentAttrs[key] : undefined,
);
// Bag-style helpers mirroring the extractor AttributeBag API, so an
// expression prototype behaves like real extractor code: `has` probes,
// `take` reads AND consumes the source key (its removal shows up in the
// rules diff, like a map rule with action "move").
evaluator.addFunction("has", (key: unknown) =>
  typeof key === "string" ? key in currentAttrs : false,
);
evaluator.addFunction("take", (key: unknown) => {
  if (typeof key !== "string") return undefined;
  const value = currentAttrs[key];
  delete currentAttrs[key];
  return value;
});

export type CompiledRule =
  | {
      kind: "map";
      rule: MapRule;
      index: number;
      keyRegex: RegExp | null;
      valueRegex: RegExp | null;
    }
  | { kind: "expression"; rule: ExpressionRule; index: number };

/**
 * Compiles/validates every rule up front so an invalid regex or
 * unparseable expression rejects the whole run with the offending rule
 * named, instead of failing span-by-span halfway through.
 */
export function compileMappingRules(rules: MappingRule[]): CompiledRule[] {
  return rules.map((rule, index): CompiledRule => {
    if (rule.kind === "expression") {
      const validation = evaluator.validate(rule.expression);
      if (!validation.valid) {
        const first = validation.errors[0];
        throw new InvalidMappingRuleError(
          index,
          "expression",
          first?.message ?? "expression does not parse",
        );
      }
      return { kind: "expression", rule, index };
    }

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

    return { kind: "map", rule, index, keyRegex, valueRegex };
  });
}

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
 * rules see the writes (and moves) of earlier ones. Runtime expression
 * failures are recorded per rule (a span's data may legitimately not
 * fit), never thrown.
 */
export function applyMappingRules(
  attributes: Record<string, unknown>,
  compiledRules: CompiledRule[],
): ApplyMappingRulesResult {
  const out: Record<string, unknown> = { ...attributes };
  const ruleResults: MappingRuleResult[] = [];

  for (const compiled of compiledRules) {
    if (compiled.kind === "expression") {
      ruleResults.push(applyExpressionRule(out, compiled));
    } else {
      ruleResults.push(applyMapRule(out, compiled));
    }
  }

  return { attributes: out, ruleResults };
}

function applyExpressionRule(
  out: Record<string, unknown>,
  compiled: Extract<CompiledRule, { kind: "expression" }>,
): MappingRuleResult {
  const { rule, index } = compiled;
  try {
    currentAttrs = out;
    const value = evaluator.evaluateSync(rule.expression, { attrs: out });
    if (value !== undefined && value !== null) {
      out[rule.targetKey] = value;
      return {
        ruleIndex: index,
        matchedKeys: [],
        writes: [{ sourceKey: null, targetKey: rule.targetKey }],
        error: null,
      };
    }
    return { ruleIndex: index, matchedKeys: [], writes: [], error: null };
  } catch (err) {
    return {
      ruleIndex: index,
      matchedKeys: [],
      writes: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    currentAttrs = {};
  }
}

function applyMapRule(
  out: Record<string, unknown>,
  compiled: Extract<CompiledRule, { kind: "map" }>,
): MappingRuleResult {
  const { rule, index, keyRegex, valueRegex } = compiled;
  const matchedKeys: string[] = [];
  const writes: MappingRuleWrite[] = [];

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
    writes.push({ sourceKey: key, targetKey: rule.action.targetKey });
    if (rule.action.type === "move" && key !== rule.action.targetKey) {
      delete out[key];
    }
  }

  return { ruleIndex: index, matchedKeys, writes, error: null };
}
