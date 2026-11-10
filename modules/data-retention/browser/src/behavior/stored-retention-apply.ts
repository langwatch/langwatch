/**
 * Applying a saved period to stored data: the count of stored traces past it, the prompt after a
 * save or from the page's note, and the apply that rewrites every project under the scope.
 * Spec: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import { useState } from "react";

import type { DataRetentionHostApi } from "../model/data-retention-host.ts";
import { dataRetentionApi } from "./data-retention-api.ts";
import { applyStoredRetention, countStoredPastRetention } from "./retention-policy-save.ts";

type Notices = Pick<DataRetentionHostApi, "succeeded" | "failed">;

export type PendingStoredApply = {
  scopes: ScopeAssignment[];
  rows: number | null;
  retentionDays: number | null;
};

export function useStoredRetentionApply({
  projectId,
  organizationId,
  viewedScope,
  notices,
}: {
  projectId: string;
  organizationId: () => string;
  viewedScope: ScopeAssignment;
  notices: Notices;
}) {
  const utils = dataRetentionApi.useUtils();
  const [pending, setPending] = useState<PendingStoredApply | null>(null);
  const viewedQuery = dataRetentionApi.dataRetention.getStoredPastRetention.useQuery({
    projectId,
    scope: viewedScope,
  });
  const applyScope = dataRetentionApi.dataRetention.applyScopeRetentionToStoredData.useMutation();

  const viewedRows =
    viewedQuery.data?.categories.reduce((total, each) => total + each.rows, 0) ?? 0;
  const viewedDays =
    viewedQuery.data?.categories.find((each) => each.category === "traces")?.retentionDays ?? null;

  /** After a save: count what the new period would delete, never the cached old period's count. */
  const offer = async (scopes: ScopeAssignment[]) => {
    const counted = await countStoredPastRetention({
      scopes,
      count: (scope) =>
        utils.dataRetention.getStoredPastRetention.fetch({ projectId, scope }, { staleTime: 0 }),
    });
    void utils.dataRetention.getStoredPastRetention.invalidate();
    if (counted && counted.rows === 0) return;
    setPending({
      scopes,
      rows: counted?.rows ?? null,
      retentionDays: counted?.retentionDays ?? null,
    });
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
    viewed: viewedRows > 0 ? { rows: viewedRows } : null,
    offer,
    offerViewed: () =>
      setPending({ scopes: [viewedScope], rows: viewedRows, retentionDays: viewedDays }),
    apply,
    dismiss: () => setPending(null),
  };
}
