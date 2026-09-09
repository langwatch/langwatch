import type {
  ModelCost,
  ModelDefaultConfig,
  ModelDefaultScope,
  ModelProvider,
} from "@langwatch/model-provider-contract";

/**
 * The rows the four memory twins share.
 *
 * One store rather than four, because the provider rows the evidence read
 * counts are the provider rows the provider repository writes: two arrays
 * would let a test attach a provider the checklist cannot see.
 */
export class MemoryModelProviderDatabase {
  static create(): MemoryModelProviderDatabase {
    return new MemoryModelProviderDatabase();
  }

  readonly providers = new Map<string, ModelProvider>();
  readonly defaults = new Map<string, ModelDefaultConfig>();
  readonly costs = new Map<string, ModelCost>();

  private constructor() {}
}

/** Whether a row attached to `scopes` is visible from `wanted`. */
export function matchesAnyScope(
  scopes: readonly ModelDefaultScope[],
  wanted: readonly ModelDefaultScope[],
): boolean {
  return scopes.some((scope) =>
    wanted.some(
      (candidate) =>
        candidate.scopeType === scope.scopeType && candidate.scopeId === scope.scopeId,
    ),
  );
}

/** Oldest first, the order every Postgres provider listing reads in. */
export function byCreatedAtAscending(
  left: Readonly<{ createdAt: Date }>,
  right: Readonly<{ createdAt: Date }>,
): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

/** Newest first, the order every Postgres default-config listing reads in. */
export function byCreatedAtDescending(
  left: Readonly<{ createdAt: Date }>,
  right: Readonly<{ createdAt: Date }>,
): number {
  return right.createdAt.getTime() - left.createdAt.getTime();
}
