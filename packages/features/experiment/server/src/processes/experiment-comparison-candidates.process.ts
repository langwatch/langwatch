/**
 * Turning a variant's stored output into the text a judge reads, and
 * naming the candidates. Pure — no port, no class. These are the seven
 * inner closures of `generateComparisonCells` that read nothing but their
 * arguments; moving them is what brings the comparison plan service under
 * the module ceiling.
 */

import { ExperimentExecutionDataService } from "../services/experiment-execution-data.service";
import { disambiguateNames, type TargetConfig } from "@langwatch/experiment-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

/**
 * Structured-output narrowing: digs into a candidate's output at the
 * configured path so the judge sees the field, not the whole JSON blob.
 * Empty/missing path is a no-op.
 */
export const pickOutputPath = (output: unknown, path?: string[]): unknown => {
  if (!path || path.length === 0) return output;
  let cursor: unknown = output;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      // Single-output-field targets are unwrapped to a scalar at storage
      // time, so mappings still record the path as ["output"]. Return the
      // scalar when the remaining path is exactly that one segment, to
      // match the runtime unwrap.
      return path.length === 1 && path[0] === segment ? cursor : undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

/**
 * Coerce a candidate's output to the judge's string input — langevals
 * 422s on a dict/list/number, so structured output must arrive
 * flattened here even with no field picked. null/undefined become "".
 */
export const toCandidateText = (output: unknown): string => {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    // Circular refs / BigInt. Nothing useful to send; treat as empty so the
    // row is skipped with "fewer than 2 candidates" instead of 422ing.
    return "";
  }
};

/**
 * A variant's existing evaluator scores, rendered as text to append to
 * its candidate text so the judge can factor them in. Empty when there
 * are no scores worth showing.
 */
export const evaluatorScoresBlock = ({
  rowIndex,
  variantId,
  completedTargetEvaluatorScores,
}: {
  rowIndex: number;
  variantId: string;
  completedTargetEvaluatorScores?: Map<
    string,
    Array<{ name: string; score?: number; label?: string; passed?: boolean }>
  >;
}): string => {
  const scores = completedTargetEvaluatorScores?.get(`${rowIndex}:${variantId}`);
  if (!scores?.length) return "";
  const lines = scores
    .map((s) => {
      const parts: string[] = [];
      if (s.score !== undefined) parts.push(`score=${s.score}`);
      if (s.label !== undefined) parts.push(`label=${s.label}`);
      if (s.passed !== undefined) parts.push(`passed=${s.passed}`);
      if (parts.length === 0) return null;
      return `- ${s.name}: ${parts.join(", ")}`;
    })
    .filter((l): l is string => l !== null);
  if (lines.length === 0) return "";
  return `\n\n--- Existing evaluator scores ---\n${lines.join("\n")}`;
};

/**
 * Prefer the prompt's HANDLE ("say-hi") as the identifier langevals
 * echoes back as the verdict label; fall back to the internal target id.
 * Never promptId — the aggregator's normalizer doesn't match it.
 */
export const variantIdentifierFor = ({
  target,
  loadedPrompts,
}: {
  target: TargetConfig;
  loadedPrompts?: Map<string, VersionedPrompt>;
}): string => {
  if (target.type === "prompt" && target.promptId) {
    const handle = loadedPrompts?.get(ExperimentExecutionDataService.promptLoadKey(target))?.handle;
    if (handle) return handle;
  }
  return target.id;
};

/**
 * Collision-safe candidate identifiers. Two variants can share a handle
 * (#5101); colliding entries fall back to the internal target id, which
 * labelNamesVariant and detectComparisonColumns already accept.
 */
export const buildVariantIdentifiers = ({
  resolvedVariants,
  loadedPrompts,
}: {
  resolvedVariants: TargetConfig[];
  loadedPrompts?: Map<string, VersionedPrompt>;
}): string[] => {
  const raw = resolvedVariants.map((target) => variantIdentifierFor({ target, loadedPrompts }));
  const counts = new Map<string, number>();
  for (const id of raw) counts.set(id, (counts.get(id) ?? 0) + 1);
  return raw.map((id, i) => ((counts.get(id) ?? 0) > 1 ? resolvedVariants[i]!.id : id));
};

/**
 * A variant's human-readable display name — NOT the collision-safe
 * identifier from buildVariantIdentifiers, which can leak raw target
 * ids into user-facing copy. Mirrors the frontend's pickTargetName.
 */
export const variantDisplayNameFor = ({
  target,
  loadedPrompts,
  loadedEvaluators,
}: {
  target: TargetConfig;
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string => {
  if (target.type === "prompt") {
    if (!target.promptId) return "New Prompt";
    const loaded = loadedPrompts?.get(ExperimentExecutionDataService.promptLoadKey(target));
    return loaded?.handle ?? loaded?.name ?? "New Prompt";
  }
  if (target.type === "evaluator" && target.targetEvaluatorId) {
    return loadedEvaluators?.get(target.targetEvaluatorId)?.name ?? target.id;
  }
  // Agents/workflows: no loaded entity map is threaded into this function, so
  // fall back to the collision-safe identifier — same as before this helper.
  return variantIdentifierFor({ target, loadedPrompts });
};

/**
 * Display names for a comparison's variants, with the same "(1)/(2)"
 * suffixing the config UI applies to same-name variants.
 */
export const buildVariantDisplayNames = ({
  resolvedVariants,
  loadedPrompts,
  loadedEvaluators,
}: {
  resolvedVariants: TargetConfig[];
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
}): string[] =>
  disambiguateNames(
    resolvedVariants.map((target) =>
      variantDisplayNameFor({ target, loadedPrompts, loadedEvaluators }),
    ),
  );
