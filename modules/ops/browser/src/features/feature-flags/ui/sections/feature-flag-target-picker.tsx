import { Text, VStack } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";
import { useState } from "react";

import {
  type FeatureFlagTargetDirectory,
  useFeatureFlagTargetSearch,
} from "../../behavior/use-feature-flag-targets.ts";
import { heldIds, withoutId, withPickedId } from "../../model/rule-targets.ts";
import { FeatureFlagTargetResults } from "../blocks/feature-flag-target-results.tsx";
import { FeatureFlagTargetChip } from "../elements/feature-flag-target-chip.tsx";

const SEARCH_PLACEHOLDER: Record<OpsFeatureFlagTargetKind, string> = {
  organization: "Search organizations by name, slug or id",
  project: "Search projects by name, slug or id",
  user: "Search users by email, name or id",
};

const PLURAL: Record<OpsFeatureFlagTargetKind, string> = {
  organization: "organizations",
  project: "projects",
  user: "users",
};

/**
 * The targets a rule holds as chips, and a search that adds one. The field
 * keeps the stored shape: one id, or ids joined by commas.
 */
export function FeatureFlagTargetPicker({
  kind,
  multiple,
  target,
  directory,
  onChange,
}: {
  kind: OpsFeatureFlagTargetKind;
  multiple: boolean;
  target: string;
  directory: FeatureFlagTargetDirectory;
  onChange: (target: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { enabled, search } = useFeatureFlagTargetSearch({ kind, query });
  const ids = heldIds(target);
  const results = enabled ? (search.data ?? []) : [];

  return (
    <VStack align="stretch" gap={1.5} width="full" minWidth={0}>
      {ids.map((id) => (
        <FeatureFlagTargetChip
          key={id}
          kind={kind}
          id={id}
          target={directory.lookup({ kind, id })}
          resolving={directory.resolving}
          failed={directory.failed}
          onRetry={directory.retry}
          onRemove={() => onChange(withoutId({ target, id }))}
        />
      ))}
      <SearchInput
        size="sm"
        containerProps={{ width: "full", minWidth: 0 }}
        aria-label={`Search ${PLURAL[kind]}`}
        placeholder={
          !multiple && ids.length > 0 ? "Search to pick a different one" : SEARCH_PLACEHOLDER[kind]
        }
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <SearchStatus
        kind={kind}
        query={query}
        enabled={enabled}
        search={search}
        found={results.length}
      />
      {results.length > 0 && (
        <FeatureFlagTargetResults
          label={`Matching ${PLURAL[kind]}`}
          results={results}
          heldIds={ids}
          onPick={(result) => {
            directory.remember(result);
            onChange(withPickedId({ target, id: result.id, multiple }));
            setQuery("");
          }}
        />
      )}
    </VStack>
  );
}

/** What the search is doing when it has no results to list: reading, failed or empty. */
function SearchStatus({
  kind,
  query,
  enabled,
  search,
  found,
}: {
  kind: OpsFeatureFlagTargetKind;
  query: string;
  enabled: boolean;
  search: ReturnType<typeof useFeatureFlagTargetSearch>["search"];
  found: number;
}) {
  if (search.isError) {
    return (
      <HandledErrorAlert
        error={search.error}
        fallbackTitle={`Couldn't search ${PLURAL[kind]}`}
        onRetry={() => void search.refetch()}
      />
    );
  }
  if (!enabled || found > 0) return null;
  if (search.isFetching) {
    return (
      <Text as="output" textStyle="xs" color="fg.muted">
        Searching {PLURAL[kind]}…
      </Text>
    );
  }
  if (!search.isSuccess) return null;
  return (
    <Text textStyle="xs" color="fg.muted">
      No {PLURAL[kind]} match "{query.trim()}".
    </Text>
  );
}
