import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import {
  FEATURE_FLAG_TARGET_LOOKUP_LIMIT,
  type OpsFeatureFlagTarget,
  type OpsFeatureFlagTargetKind,
} from "@langwatch/ops-contract";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../behavior/ops-api.ts";
import { targetIdsOf, targetKey } from "../model/rule-targets.ts";

/** The shortest query a target search runs for, so one letter does not list the fleet. */
const MIN_QUERY_LENGTH = 2;

export interface FeatureFlagTargetDirectory {
  /** The target behind an id, once known; undefined while it resolves or when nothing answers. */
  lookup: (input: {
    kind: OpsFeatureFlagTargetKind;
    id: string;
  }) => OpsFeatureFlagTarget | undefined;
  /** Whether the stored rules' ids are still being resolved. */
  resolving: boolean;
  /** Whether resolving the stored ids failed, so a missing target is unknown, not absent. */
  failed: boolean;
  /** Reads the stored ids again after a failure. */
  retry: () => void;
  /** Keeps a picked search result, so its chip shows details without another read. */
  remember: (target: OpsFeatureFlagTarget) => void;
}

/** The targets the stored rules name, resolved once per dialog opening, plus every pick since. */
export function useFeatureFlagTargetDirectory({
  rules,
  open,
}: {
  rules: FeatureFlagRules;
  open: boolean;
}): FeatureFlagTargetDirectory {
  const batches = lookupBatches(targetIdsOf(rules));
  const stored = api.useQueries((t) =>
    batches.map((batch) => t.ops.findFeatureFlagTargets(batch, { enabled: open })),
  );
  const [picked, setPicked] = useState<ReadonlyMap<string, OpsFeatureFlagTarget>>(new Map());

  // A pick only outlives its opening as a stale copy: the next opening reads every id again.
  useEffect(() => {
    if (open) setPicked(new Map());
  }, [open]);

  const known = new Map<string, OpsFeatureFlagTarget>();
  for (const target of stored.flatMap((batch) => batch.data ?? [])) {
    known.set(targetKey(target), target);
  }
  for (const [key, target] of picked) known.set(key, target);

  return {
    lookup: (target) => known.get(targetKey(target)),
    resolving: stored.some((batch) => batch.isLoading),
    failed: stored.some((batch) => batch.isError),
    retry: () => {
      for (const batch of stored) if (batch.isError) void batch.refetch();
    },
    remember: (target) => setPicked((current) => new Map(current).set(targetKey(target), target)),
  };
}

type TargetIds = ReturnType<typeof targetIdsOf>;

/** The ids split into reads the lookup accepts, each list within its limit; none when empty. */
function lookupBatches(ids: TargetIds): TargetIds[] {
  const size = FEATURE_FLAG_TARGET_LOOKUP_LIMIT;
  const longest = Math.max(ids.organizationIds.length, ids.projectIds.length, ids.userIds.length);
  return Array.from({ length: Math.ceil(longest / size) }, (_, index) => ({
    organizationIds: ids.organizationIds.slice(index * size, (index + 1) * size),
    projectIds: ids.projectIds.slice(index * size, (index + 1) * size),
    userIds: ids.userIds.slice(index * size, (index + 1) * size),
  }));
}

/** Targets of one kind matching what the operator typed, read once typing pauses. */
export function useFeatureFlagTargetSearch({
  kind,
  query,
}: {
  kind: OpsFeatureFlagTargetKind;
  query: string;
}) {
  const [debounced] = useDebounce(query.trim(), 250);
  const enabled = debounced.length >= MIN_QUERY_LENGTH;
  const search = api.ops.searchFeatureFlagTargets.useQuery({ kind, query: debounced }, { enabled });
  return { enabled, search };
}
