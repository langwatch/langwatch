/**
 * Applying a saved period to stored data: the count per category past it, the prompt after a
 * save or from the page's note, and the apply that rewrites every project under the scope.
 * Spec: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import type { ScopeAssignment, StoredPastRetention } from "@langwatch/data-retention-contract";
import { useState } from "react";

import type { DataRetentionHostApi } from "../model/data-retention-host.ts";
import { storedPastRetentionTotal } from "../model/stored-retention-copy.ts";
import { dataRetentionApi } from "./data-retention-api.ts";
import { applyStoredRetention, countStoredPastRetention } from "./retention-policy-save.ts";

type Notices = Pick<DataRetentionHostApi, "succeeded" | "failed">;

/** The scopes an apply would rewrite and what it would delete; null `counted` if uncounted. */
export type PendingStoredApply = {
  scopes: ScopeAssignment[];
  counted: StoredPastRetention | null;
};

export function useStoredRetentionApply({
  projectId,
  organizationId,
  viewedScope,
  notices,
  canApply,
}: {
  projectId: string;
  organizationId: () => string;
  viewedScope: ScopeAssignment;
  notices: Notices;
  /** Only a reader who can apply pays for the stored-data count. */
  canApply: boolean;
}) {
  const utils = dataRetentionApi.useUtils();
  const [pending, setPending] = useState<PendingStoredApply | null>(null);
  const viewedQuery = dataRetentionApi.dataRetention.getStoredPastRetention.useQuery(
    { projectId, scope: viewedScope },
    { enabled: canApply, staleTime: 60_000 },
  );
  const applyScope = dataRetentionApi.dataRetention.applyScopeRetentionToStoredData.useMutation();

  const viewedCount = viewedQuery.data ?? null;
  const viewedRows = viewedCount ? storedPastRetentionTotal(viewedCount) : 0;

  /** After a save: count what the new period would delete, never the cached old period's count. */
  const offer = async (scopes: ScopeAssignment[]) => {
    const counted = await countStoredPastRetention({
      scopes,
      count: (scope) =>
        utils.dataRetention.getStoredPastRetention.fetch({ projectId, scope }, { staleTime: 0 }),
    });
    void utils.dataRetention.getStoredPastRetention.invalidate();
    if (counted && storedPastRetentionTotal(counted) === 0) return;
    setPending({ scopes, counted });
  };

  const apply = async () => {
    if (!pending) return;
    const { success } = await applyStoredRetention({
      scopes: pending.scopes,
      apply: (scope) =>
        applyScope.mutateAsync({ projectId, organizationId: organizationId(), scope }),
      notices,
    });
    if (success) setPending(null);
    void utils.dataRetention.getStoredPastRetention.invalidate();
  };

  return {
    pending,
    isApplying: applyScope.isPending,
    viewed: viewedCount && viewedRows > 0 ? viewedCount : null,
    offer,
    offerViewed: () => setPending({ scopes: [viewedScope], counted: viewedCount }),
    apply,
    dismiss: () => setPending(null),
  };
}
