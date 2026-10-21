/**
 * ADR-183 §3: a braid's condition as its compiler stores it beside the OTTL text, and the bounds
 * the compiler and the store client's fence both read. The tree holds conjunctions of string
 * comparisons only, so the fence renders it as one bracketed conjunction of bound parameters.
 */
import { z } from "zod";

import { sha256Hex } from "./braid-condition-digest.ts";

/** Stored with every compiled condition; part of every fence cache key. */
export const BRAID_CONDITION_COMPILER_VERSION = 1;
/** Longest condition text one braid may hold, in characters. */
export const BRAID_CONDITION_MAX_LENGTH = 1000;
/** Comparisons in one condition. */
export const BRAID_CONDITION_MAX_TERMS = 16;
/** Nested parentheses in one condition. */
export const BRAID_CONDITION_MAX_DEPTH = 4;
/** Distinct compiled conditions one reader's proof may hold. */
export const BRAID_MAX_DISTINCT_CONDITIONS = 50;
/** Verified marks: `<prefix><key>` holds the id of the project that signed `key` (§4). */
export const VERIFIED_ATTRIBUTE_PREFIX = "langwatch.reserved.verified.";

const conditionText = z.string().min(1).max(BRAID_CONDITION_MAX_LENGTH);

/** One comparison. `== ""` is refused on save, so a value is never empty. */
export const braidConditionTermSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attributeEquals"),
      on: z.enum(["span", "resource"]),
      key: conditionText,
      value: conditionText,
    })
    .strict(),
  z.object({ kind: z.literal("nameEquals"), value: conditionText }).strict(),
  z.object({ kind: z.literal("attributePresent"), key: conditionText }).strict(),
  z.object({ kind: z.literal("verified"), key: conditionText }).strict(),
]);
export type BraidConditionTerm = z.infer<typeof braidConditionTermSchema>;

/** A conjunction of terms and nested conjunctions; never empty (no condition is no tree). */
export const braidConditionAndSchema = z
  .object({
    kind: z.literal("and"),
    get terms(): z.ZodArray<
      z.ZodUnion<readonly [typeof braidConditionTermSchema, typeof braidConditionAndSchema]>
    > {
      return z
        .array(z.union([braidConditionTermSchema, braidConditionAndSchema]))
        .min(1)
        .max(BRAID_CONDITION_MAX_TERMS);
    },
  })
  .strict();
export type BraidConditionAnd = z.infer<typeof braidConditionAndSchema>;

export const braidConditionNodeSchema = z.union([
  braidConditionTermSchema,
  braidConditionAndSchema,
]);
export type BraidConditionNode = z.infer<typeof braidConditionNodeSchema>;

/** The comparisons a tree holds, in order: the conjunction the fence renders. */
export function braidConditionTermsOf(node: BraidConditionNode): BraidConditionTerm[] {
  return node.kind === "and" ? node.terms.flatMap(braidConditionTermsOf) : [node];
}

/** Conjunctions nested along the deepest path; a lone term has none. */
function depthOf(node: BraidConditionNode): number {
  return node.kind === "and" ? 1 + Math.max(...node.terms.map(depthOf)) : 0;
}

const charactersOf = (term: BraidConditionTerm): number =>
  ("key" in term ? term.key.length : 0) + ("value" in term ? term.value.length : 0);

/**
 * `where` compiled on save: the compiler's version and its tree. Bounded as the text is: the
 * top-level conjunction plus `BRAID_CONDITION_MAX_DEPTH` parenthesised ones, at most
 * `BRAID_CONDITION_MAX_TERMS` comparisons, and no more literal characters than the text holds.
 */
export const compiledWhereSchema = z
  .object({
    version: z.number().int().min(1),
    tree: braidConditionNodeSchema,
  })
  .strict()
  .refine(({ tree }) => braidConditionTermsOf(tree).length <= BRAID_CONDITION_MAX_TERMS, {
    message: `a condition holds at most ${BRAID_CONDITION_MAX_TERMS} comparisons`,
    path: ["tree"],
  })
  .refine(({ tree }) => depthOf(tree) <= BRAID_CONDITION_MAX_DEPTH + 1, {
    message: `a condition nests at most ${BRAID_CONDITION_MAX_DEPTH} deep`,
    path: ["tree"],
  })
  .refine(
    ({ tree }) =>
      braidConditionTermsOf(tree).reduce((total, term) => total + charactersOf(term), 0) <=
      BRAID_CONDITION_MAX_LENGTH,
    {
      message: `a condition holds at most ${BRAID_CONDITION_MAX_LENGTH} characters`,
      path: ["tree"],
    },
  );
export type CompiledWhere = z.infer<typeof compiledWhereSchema>;

/** A canonical, injective form of a tree: arrays in a fixed order, strings JSON-escaped. */
function canonicalOf(node: BraidConditionNode): unknown[] {
  switch (node.kind) {
    case "and":
      return ["and", ...node.terms.map(canonicalOf)];
    case "attributeEquals":
      return [node.kind, node.on, node.key, node.value];
    case "nameEquals":
      return [node.kind, node.value];
    case "attributePresent":
    case "verified":
      return [node.kind, node.key];
  }
}

/**
 * The digest a cache or log key carries for a compiled condition: its tree and its compiler
 * version, so a key changes when either does. Braids sharing one digest share one predicate.
 */
export function braidConditionDigest(compiledWhere: CompiledWhere): string {
  return sha256Hex(JSON.stringify([compiledWhere.version, canonicalOf(compiledWhere.tree)]));
}
