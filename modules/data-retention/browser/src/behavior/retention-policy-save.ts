/** Saving a retention policy: one write per scope and category, reported once. */

import {
  retentionCategories,
  type RetentionCategory,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";

import type { DataRetentionHostApi } from "../model/data-retention-host.ts";
import { formatDays } from "../model/retention-format.ts";
import type { RetentionScopeGroup } from "../model/retention-grouping.ts";

type Notices = Pick<DataRetentionHostApi, "succeeded" | "failed">;

type CategoryOutcome =
  | { ok: true; category: RetentionCategory }
  | { ok: false; category: RetentionCategory; error: unknown };

type RetentionSaveResult = {
  pairs: { scope: ScopeAssignment; category: RetentionCategory }[];
  results: CategoryOutcome[];
};

/** Writes the policy for every scope and category, keeping each outcome. */
async function saveRetentionOverrides({
  scopes,
  categories,
  save,
}: {
  scopes: ScopeAssignment[];
  categories: RetentionCategory[];
  save: (pair: { scope: ScopeAssignment; category: RetentionCategory }) => Promise<unknown>;
}): Promise<RetentionSaveResult> {
  const pairs = scopes.flatMap((scope) => categories.map((category) => ({ scope, category })));
  const results = await Promise.all(
    pairs.map((pair): Promise<CategoryOutcome> =>
      save(pair).then(
        () => ({ ok: true, category: pair.category }),
        (error: unknown) => ({ ok: false, category: pair.category, error }),
      ),
    ),
  );
  return { pairs, results };
}

/**
 * One notice for the batch. The partial count is an outcome, not an error headline:
 * a recognised code overrides `fallbackTitle`, which would erase "Saved 7 of 9", so
 * the two are reported separately.
 */
function reportRetentionSave({
  result: { pairs, results },
  scopeCount,
  notices,
}: {
  result: RetentionSaveResult;
  scopeCount: number;
  notices: Notices;
}): { success: boolean } {
  const failed = results.filter((entry) => !entry.ok);
  if (failed.length === 0) {
    notices.succeeded({
      title:
        scopeCount === 1
          ? "Retention policy saved"
          : `Retention policy saved for ${scopeCount} scopes`,
    });
    return { success: true };
  }
  if (failed.length < pairs.length) {
    notices.succeeded({
      title: `Saved ${pairs.length - failed.length} of ${pairs.length} updates`,
    });
  }
  const firstError = failed.find(
    (entry): entry is Extract<CategoryOutcome, { ok: false }> => !entry.ok,
  );
  notices.failed({ error: firstError?.error, fallbackTitle: "Couldn't save the retention policy" });
  return { success: false };
}

/** The categories whose policy saved, each once. */
function savedCategories(result: RetentionSaveResult): RetentionCategory[] {
  return Array.from(
    new Set(result.results.filter((entry) => entry.ok).map((entry) => entry.category)),
  );
}

/**
 * Rewrites existing rows for each saved category. The server resolves the cascade, so
 * a wider rule may not change what a project with a closer override uses: the notice
 * names the value the server applied, not the one typed.
 */
async function applyRetentionToExisting({
  categories,
  trigger,
  notices,
}: {
  categories: RetentionCategory[];
  trigger: (category: RetentionCategory) => Promise<{ appliedRetentionDays: number }>;
  notices: Notices;
}): Promise<void> {
  if (categories.length === 0) return;
  const outcomes = await Promise.all(
    categories.map((category) =>
      trigger(category).then(
        (response) => ({ ok: true as const, applied: response.appliedRetentionDays }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ),
  );
  const failure = outcomes.find((entry) => !entry.ok);
  if (failure && !failure.ok) {
    notices.failed({ error: failure.error, fallbackTitle: "Some retroactive updates failed" });
    return;
  }
  const applied = Array.from(
    new Set(outcomes.flatMap((entry) => (entry.ok ? [entry.applied] : []))),
  );
  notices.succeeded({
    title: "Applying retention to existing data…",
    description: rewriteDescription(applied),
  });
}

function rewriteDescription(applied: number[]): string {
  const [only] = applied;
  if (applied.length === 1 && only !== undefined) {
    return `Rewriting existing rows to ${formatDays(only)}.`;
  }
  return `Rewriting existing rows per category (${applied.map(formatDays).join(", ")}).`;
}

type RetentionPolicyInput = {
  scopes: ScopeAssignment[];
  retentionDays: number;
  applyToExisting: boolean;
};

/**
 * The drawer's save: straight through, or via the apply-to-existing confirmation,
 * which rewrites only the current project's rows and says so when a wider scope saved.
 */
export function retentionPolicySaver({
  projectId,
  notices,
  write,
  trigger,
  afterWrite,
  close,
  confirm,
}: {
  projectId: string;
  notices: Notices;
  write: (input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }) => Promise<unknown>;
  trigger: (category: RetentionCategory) => Promise<{ appliedRetentionDays: number }>;
  afterWrite: () => void;
  close: () => void;
  confirm: (pending: {
    retentionDays: number;
    savedScopeWiderThanCurrentProject: boolean;
    onConfirm: () => Promise<void>;
  }) => void;
}): (input: RetentionPolicyInput) => Promise<void> {
  return async ({ scopes, retentionDays, applyToExisting }) => {
    const saveAndReport = async () => {
      const result = await saveRetentionOverrides({
        scopes,
        categories: [...retentionCategories],
        save: (pair) => write({ ...pair, retentionDays }),
      });
      afterWrite();
      const status = reportRetentionSave({ result, scopeCount: scopes.length, notices });
      return { result, status };
    };

    if (!applyToExisting) {
      const { status } = await saveAndReport();
      if (status.success) close();
      return;
    }

    confirm({
      retentionDays,
      savedScopeWiderThanCurrentProject: scopes.some(
        (scope) => !(scope.scopeType === "PROJECT" && scope.scopeId === projectId),
      ),
      onConfirm: async () => {
        const { result, status } = await saveAndReport();
        await applyRetentionToExisting({ categories: savedCategories(result), trigger, notices });
        if (status.success) close();
      },
    });
  };
}

/** Removes a scope's policy in every category it sets, reported once. */
export async function removeRetentionScope({
  group,
  remove,
  afterWrite,
  notices,
}: {
  group: RetentionScopeGroup;
  remove: (input: { scope: ScopeAssignment; category: RetentionCategory }) => Promise<unknown>;
  afterWrite: () => void;
  notices: Notices;
}): Promise<void> {
  const categories = retentionCategories.filter(
    (category) => group.byCategory[category] !== undefined,
  );
  const scope = { scopeType: group.scopeType, scopeId: group.scopeId };
  const outcomes = await Promise.all(
    categories.map((category) =>
      remove({ scope, category }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ),
  );
  afterWrite();
  const failure = outcomes.find((entry) => !entry.ok);
  if (failure && !failure.ok) {
    notices.failed({ error: failure.error, fallbackTitle: "Couldn't remove the retention policy" });
    return;
  }
  notices.succeeded({
    title: categories.length === 1 ? "Override removed" : "Retention policy removed",
  });
}
