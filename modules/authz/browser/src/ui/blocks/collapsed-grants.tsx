// One holder's roles, each with where it applies (main's CollapsedGrants.tsx): past a
// couple of scopes a role says how many there are and offers to show them.
// specs/identity/org-access-cluster.feature

import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

import {
  type CollapsedGrant,
  roleTone,
  scopeLabel,
  summariseScopes,
} from "../../model/role-holders.ts";

/** How many scopes a grant shows before it starts summarising instead. */
const VISIBLE_SCOPES = 2;

export function CollapsedGrantRow({ grant }: { grant: CollapsedGrant }) {
  const [expanded, setExpanded] = useState(false);
  const overflows = grant.scopes.length > VISIBLE_SCOPES;
  const showChips = expanded || !overflows;

  return (
    <HStack gap={2} fontSize="xs" flexWrap="wrap" justify="end">
      <Badge colorPalette={roleTone(grant.tier)} size="sm">
        <Text as="span" truncate maxWidth="200px" title={grant.roleName}>
          {grant.roleName}
        </Text>
      </Badge>
      <Text color="fg.muted">on</Text>
      {showChips ? (
        grant.scopes.map((scope) => (
          <Badge key={scope.scopeId} colorPalette="gray" variant="outline" size="sm">
            {scopeLabel(scope)}
          </Badge>
        ))
      ) : (
        <Text color="fg">{summariseScopes(grant.scopes)}</Text>
      )}
      {overflows && (
        <Button
          size="xs"
          variant="plain"
          height="auto"
          padding={0}
          color="fg.muted"
          textDecoration="underline"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show fewer" : `Show all ${grant.scopes.length}`}
        </Button>
      )}
    </HStack>
  );
}

/** Everything one holder holds, or the honest absence: never a blank. */
export function CollapsedGrantList({ grants }: { grants: readonly CollapsedGrant[] }) {
  if (grants.length === 0) {
    return (
      <Text fontSize="xs" color="fg.subtle">
        No role assigned
      </Text>
    );
  }

  return (
    <VStack gap={1.5} align="end">
      {grants.map((grant) => (
        <CollapsedGrantRow key={grant.key} grant={grant} />
      ))}
    </VStack>
  );
}
