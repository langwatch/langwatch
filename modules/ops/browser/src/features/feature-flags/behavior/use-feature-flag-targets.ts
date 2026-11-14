import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import type { OpsFeatureFlagTarget, OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";
import { useState } from "react";
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
  const ids = targetIdsOf(rules);
  const named = ids.organizationIds.length + ids.projectIds.length + ids.userIds.length > 0;
  const stored = api.ops.findFeatureFlagTargets.useQuery(ids, { enabled: open && named });
  const [picked, setPicked] = useState<ReadonlyMap<string, OpsFeatureFlagTarget>>(new Map());

  const known = new Map<string, OpsFeatureFlagTarget>();
  for (const target of stored.data ?? []) known.set(targetKey(target), target);
  for (const [key, target] of picked) known.set(key, target);

  return {
    lookup: (target) => known.get(targetKey(target)),
    resolving: named && stored.isLoading,
    remember: (target) => setPicked((current) => new Map(current).set(targetKey(target), target)),
  };
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
