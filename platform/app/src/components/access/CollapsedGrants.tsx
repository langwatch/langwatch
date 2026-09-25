import { Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { roleTone, scopeLabel } from "./roleAssignments";
import type { CollapsedGrant } from "./roleHolders";
import { summariseScopes } from "./roleHolders";

/** How many scopes a grant shows before it starts summarising instead. */
const VISIBLE_SCOPES = 2;

/**
 * One role, and where its holder was granted it.
 *
 * Colour carries exactly one thing on this row: how much the role can do.
 * The scopes are drawn in the neutral tone whatever kind they are, because a
 * row where the role, the scope and the source each pick their own palette is
 * a row of confetti, and the reader learns nothing from any of it. Scopes are
 * still spelled out in full — "Team Platform", never "Team" and an icon the
 * reader has to decode.
 *
 * An administrator on the organization and on six teams is one line, not
 * seven: past a couple of scopes the row says how many there are and offers
 * to show them, which is the answer to the question actually being asked.
 */
export function CollapsedGrantRow({ grant }: { grant: CollapsedGrant }) {
  const [expanded, setExpanded] = useState(false);
  const overflows = grant.scopes.length > VISIBLE_SCOPES;
  const showChips = expanded || !overflows;

  return (
    <HStack gap={2} fontSize="xs" flexWrap="wrap" justify="end">
      <Badge colorPalette={roleTone(grant.tier)} size="sm">
        {grant.roleName}
      </Badge>
      <Text color="fg.muted">on</Text>
      {showChips ? (
        grant.scopes.map((scope) => (
          <Badge
            key={scope.scopeId}
            colorPalette="gray"
            variant="outline"
            size="sm"
          >
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

/**
 * Everything one person, group or key holds, or the honest absence. A blank
 * here reads as "still loading" to somebody scanning for people with no
 * access, so there is never a blank.
 */
export function CollapsedGrantList({
  grants,
}: {
  grants: readonly CollapsedGrant[];
}) {
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
