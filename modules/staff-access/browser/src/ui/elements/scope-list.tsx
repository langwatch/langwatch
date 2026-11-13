/** Each requested scope with the one plain line that says what it opens. */

import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { StaffAccessScopeName } from "@langwatch/staff-access-contract";

import { SCOPE_COPY, scopeLabel } from "../../model/staff-access-copy.ts";

export function ScopeList({ scopes }: { scopes: readonly StaffAccessScopeName[] }) {
  return (
    <VStack align="stretch" gap={3} data-testid="staff-access-scopes">
      {scopes.map((scope) => (
        <VStack key={scope} align="start" gap={0.5}>
          <Text textStyle="label">{SCOPE_COPY[scope].label}</Text>
          <Text textStyle="bodySm" color="fg.muted">
            {SCOPE_COPY[scope].line}
          </Text>
        </VStack>
      ))}
    </VStack>
  );
}

/** The short form a table row uses. */
export function ScopeBadges({ scopes }: { scopes: readonly StaffAccessScopeName[] }) {
  return (
    <HStack gap={1} wrap="wrap">
      {scopes.map((scope) => (
        <Badge key={scope} size="sm" variant="subtle">
          {scopeLabel(scope)}
        </Badge>
      ))}
    </HStack>
  );
}
