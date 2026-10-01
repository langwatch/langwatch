/** Langy skip-permissions allowlist (ADR-129); pure logic shared between drawer and server. */
import { modelProviders } from "../model-provider-registry.ts";

/** One entry per line, blanks and surrounding spaces dropped. */
export function parseSkipListInput(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The text a textarea shows for a stored list. */
export function skipListToInput(patterns: readonly string[] | null | undefined): string {
  return (patterns ?? []).join("\n");
}

/** The first entry that does not compile, with its one-based line number. */
export function detectInvalidSkipPattern(
  patterns: readonly string[],
): { line: number; pattern: string } | null {
  for (const [index, pattern] of patterns.entries()) {
    try {
      new RegExp(pattern);
    } catch {
      return { line: index + 1, pattern };
    }
  }
  return null;
}

/**
 * Whether a bare model id matches any pattern in the list. A pattern that
 * doesn't compile is skipped, not thrown on: the write path refuses those,
 * so a bad line reaching a read must not deny every model.
 */
export function matchesSkipList({
  patterns,
  modelId,
}: {
  patterns: readonly string[];
  modelId: string;
}): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(modelId);
    } catch {
      return false;
    }
  });
}

/** The registry default for a provider, empty for one we do not know. */
export function defaultSkipListForProvider(provider: string): readonly string[] {
  const definition = modelProviders[provider as keyof typeof modelProviders] ?? null;
  return definition?.langySkipPermissionsModels ?? [];
}

/** Reads a stored JSON column back into a pattern list. */
export function readStoredSkipList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * The list that decides the answer for a provider: the operator's list when
 * they stored one, the registry default otherwise. An empty stored list is a
 * cleared field, which means "use the default" rather than "trust nothing".
 */
export function resolveSkipList({
  provider,
  stored,
}: {
  provider: string;
  stored: unknown;
}): readonly string[] {
  const custom = readStoredSkipList(stored);
  return custom.length > 0 ? custom : defaultSkipListForProvider(provider);
}
