import { Card } from "@langwatch/design-system/card";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";
import { useState } from "react";

import {
  type FeatureFlagTargetDirectory,
  useFeatureFlagTargetSearch,
} from "../../behavior/use-feature-flag-targets.ts";
import { heldIds, withoutId, withPickedId } from "../../model/rule-targets.ts";
import { FeatureFlagTargetChip } from "../elements/feature-flag-target-chip.tsx";
import { FeatureFlagTargetSummary } from "../elements/feature-flag-target-summary.tsx";

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
      {enabled && search.isFetching && results.length === 0 && (
        <Text as="output" textStyle="xs" color="fg.muted">
          Searching {PLURAL[kind]}…
        </Text>
      )}
      {search.isError && (
        <HandledErrorAlert error={search.error} fallbackTitle={`Couldn't search ${PLURAL[kind]}`} />
      )}
      {enabled && search.isSuccess && results.length === 0 && (
        <Text textStyle="xs" color="fg.muted">
          No {PLURAL[kind]} match "{query.trim()}".
        </Text>
      )}
      {results.length > 0 && (
        <Card variant="elevated" padding="xs">
          <VStack
            align="stretch"
            gap={0.5}
            maxHeight="72"
            overflowY="auto"
            aria-label={`Matching ${PLURAL[kind]}`}
          >
            {results.map((result) => {
              const held = ids.includes(result.id);
              return (
                <Button
                  key={result.id}
                  aria-pressed={held}
                  variant="ghost"
                  justifyContent="start"
                  height="auto"
                  whiteSpace="normal"
                  paddingY={1.5}
                  onClick={() => {
                    directory.remember(result);
                    onChange(withPickedId({ target, id: result.id, multiple }));
                    setQuery("");
                  }}
                >
                  <HStack gap={2} width="full" minWidth={0}>
                    <FeatureFlagTargetSummary target={result} />
                    {held && (
                      <Badge size="sm" colorPalette="green" marginStart="auto">
                        added
                      </Badge>
                    )}
                  </HStack>
                </Button>
              );
            })}
          </VStack>
        </Card>
      )}
    </VStack>
  );
}
