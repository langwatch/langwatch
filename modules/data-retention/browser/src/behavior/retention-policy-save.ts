/** Saving a retention policy: one write per scope and category, reported once. */

import {
  retentionCategories,
  type RetentionCategory,
  type ScopeAssignment,
  type StoredPastRetention,
} from "@langwatch/data-retention-contract";

import type { DataRetentionHostApi } from "../model/data-retention-host.ts";
import type { RetentionScopeGroup } from "../model/retention-grouping.ts";

type Notices = Pick<DataRetentionHostApi, "succeeded" | "warned" | "informed" | "failed">;

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
    notices.warned({
      title: `Saved ${pairs.length - failed.length} of ${pairs.length} updates`,
    });
  }
  const firstError = failed.find(
    (entry): entry is Extract<CategoryOutcome, { ok: false }> => !entry.ok,
  );
  notices.failed({ error: firstError?.error, fallbackTitle: "Couldn't save the retention policy" });
  return { success: false };
}

type RetentionPolicyInput = { scopes: ScopeAssignment[]; retentionDays: number };

/**
 * The drawer's save: one write per scope and category, reported once. A longer period reaches
 * stored rows on the server; `afterSave` then offers the scopes saved for a shorter one.
 */
export function retentionPolicySaver({
  notices,
  write,
  afterWrite,
  afterSave,
  close,
}: {
  notices: Notices;
  write: (input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }) => Promise<unknown>;
  afterWrite: () => void;
  afterSave: (saved: { scopes: ScopeAssignment[]; retentionDays: number }) => void;
  close: () => void;
}): (input: RetentionPolicyInput) => Promise<void> {
  return async ({ scopes, retentionDays }) => {
    const result = await saveRetentionOverrides({
      scopes,
      categories: [...retentionCategories],
      save: (pair) => write({ ...pair, retentionDays }),
    });
    afterWrite();
    const status = reportRetentionSave({ result, scopeCount: scopes.length, notices });
    if (!status.success) return;
    close();
    afterSave({ scopes, retentionDays });
  };
}

/**
 * Stored items past the new period summed over the saved scopes, for the apply prompt; null
 * when any count failed, so the prompt says it could not count rather than "0".
 */
export async function countStoredPastRetention({
  scopes,
  count,
}: {
  scopes: ScopeAssignment[];
  count: (scope: ScopeAssignment) => Promise<StoredPastRetention>;
}): Promise<{ rows: number; retentionDays: number | null } | null> {
  try {
    const answers = await Promise.all(scopes.map((scope) => count(scope)));
    const traces = answers.flatMap((answer) =>
      answer.categories.filter((each) => each.category === "traces"),
    );
    const days = new Set(traces.map((each) => each.retentionDays));
    const [only] = [...days];
    return {
      rows: answers.reduce(
        (sum, answer) => sum + answer.categories.reduce((total, each) => total + each.rows, 0),
        0,
      ),
      retentionDays: days.size === 1 && only !== undefined ? only : null,
    };
  } catch {
    return null;
  }
}

/** Asks the server to apply each scope's period to its stored data, reported once. */
export async function applyStoredRetention({
  scopes,
  apply,
  notices,
}: {
  scopes: ScopeAssignment[];
  apply: (scope: ScopeAssignment) => Promise<unknown>;
  notices: Pick<Notices, "succeeded" | "failed">;
}): Promise<{ success: boolean }> {
  const outcomes = await Promise.all(
    scopes.map((scope) =>
      apply(scope).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ),
  );
  const failure = outcomes.find((entry) => !entry.ok);
  if (failure && !failure.ok) {
    notices.failed({ error: failure.error, fallbackTitle: "Couldn't apply the new period" });
    return { success: false };
  }
  notices.succeeded({ title: "Traces past the new period will be deleted within a day" });
  return { success: true };
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
