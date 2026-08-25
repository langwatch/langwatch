import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { KeyRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { CollapsedGrantList } from "./CollapsedGrants";
import { IdentityChip, IdentityRow, IdentityRowList } from "./IdentityRow";
import { ROLE_ASSIGNMENT_WORDS } from "./roleAssignments";
import type { AssignmentRow, Holder } from "./roleHolders";
import { holdersOf, scopeCounts } from "./roleHolders";

type ScopeFilter = "ALL" | RoleBindingScopeType;

/**
 * Every role assignment in the organization, gathered onto whoever holds it.
 *
 * This was a page of its own called Role Bindings, which put a reader one nav
 * entry away from the roles those assignments use and asked them to learn a
 * word only this codebase says. It is now the second tab of Roles: the
 * definitions and the grants of those definitions, in one place, in the
 * vocabulary every other identity product uses.
 *
 * The read returns one row per grant, and an organization of any size has
 * hundreds — the same person, the same role, over and over, once per team.
 * Drawn one per line that is a wall nobody can count. So the rows are folded
 * onto their holder and then onto their role before anything is drawn, and a
 * role granted in more places than a line has room for says how many rather
 * than listing them (`roleHolders.ts`).
 *
 * Read-only, deliberately. An assignment is made where its subject lives — on
 * a person, in the person drawer, or on a group, in the group it belongs to —
 * because that is where the reader can see everything else the change affects.
 * This is the view that answers "who can reach what", which is a question with
 * a different shape and a different reader.
 */
const FILTERS: { label: string; value: ScopeFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Organization", value: RoleBindingScopeType.ORGANIZATION },
  { label: "Teams", value: RoleBindingScopeType.TEAM },
  { label: "Projects", value: RoleBindingScopeType.PROJECT },
];

export function RoleAssignmentsPanel({
  organizationId,
  onOpenPerson,
}: {
  organizationId: string;
  /** Opens the person drawer, where an assignment is actually changed. */
  onOpenPerson?: (userId: string) => void;
}) {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("ALL");

  const assignments = api.roleBinding.listForOrg.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );

  const rows = useMemo<AssignmentRow[]>(
    () => assignments.data ?? [],
    [assignments.data],
  );
  // Counted across everything, not across the current filter: a filter chip
  // that only knows about the rows it is already showing cannot tell the
  // reader whether there is anything behind it.
  const counts = useMemo(() => scopeCounts(rows), [rows]);
  const holders = useMemo(
    () =>
      holdersOf(
        scopeFilter === "ALL"
          ? rows
          : rows.filter((row) => row.scopeType === scopeFilter),
      ),
    [rows, scopeFilter],
  );

  if (assignments.isError) {
    return (
      <SectionErrorNotice
        error={assignments.error}
        fallbackTitle={`Couldn't load your ${ROLE_ASSIGNMENT_WORDS.plural.toLowerCase()}`}
      />
    );
  }

  return (
    <Box width="full">
      <HStack width="full" marginBottom={4}>
        <ScopeFilterChips
          selected={scopeFilter}
          counts={counts}
          onSelect={setScopeFilter}
        />
        <Spacer />
        {assignments.data && (
          <Text fontSize="sm" color="fg.muted">
            {holders.length}{" "}
            {holders.length === 1 ? "member or group" : "members and groups"}
          </Text>
        )}
      </HStack>

      {assignments.isLoading ? (
        <Box padding={8} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : (
        <IdentityRowList
          data-testid="role-assignments-list"
          empty="Nobody has been assigned a role yet."
        >
          {holders.map((holder) => (
            <IdentityRow
              key={holder.key}
              id={holder.userId ?? holder.key}
              name={holder.name}
              address={holder.address}
              image={holder.image}
              data-testid="role-assignment-row"
              onOpen={
                holder.userId && onOpenPerson
                  ? () => onOpenPerson(holder.userId as string)
                  : undefined
              }
              badges={<HolderKindBadge holder={holder} />}
              chips={
                holder.kind === "group" && holder.directory ? (
                  <IdentityChip
                    label="Directory"
                    title={`This group is managed by ${holder.directory}.`}
                  />
                ) : null
              }
              trailing={<CollapsedGrantList grants={holder.grants} />}
            />
          ))}
        </IdentityRowList>
      )}
    </Box>
  );
}

/**
 * What kind of holder this row is, when it is not a person.
 *
 * An API key holds role assignments exactly as a person does, and every one of
 * them used to arrive with no user and no group and land in a single shared
 * row with no name on it. Naming the kind is what keeps that row countable.
 */
/**
 * The scope filter, each chip carrying how much is behind it.
 *
 * The numbers come from every assignment rather than from the ones currently
 * shown: a filter that only knows about the rows it is already displaying
 * cannot tell the reader whether pressing it is worth anything.
 */
function ScopeFilterChips({
  selected,
  counts,
  onSelect,
}: {
  selected: ScopeFilter;
  counts: Record<ScopeFilter, number>;
  onSelect: (next: ScopeFilter) => void;
}) {
  return (
    <HStack gap={1} flexWrap="wrap">
      {FILTERS.map((filter) => {
        const active = selected === filter.value;
        return (
          <Button
            key={filter.value}
            size="sm"
            variant={active ? "subtle" : "ghost"}
            colorPalette={active ? "blue" : "gray"}
            borderRadius="full"
            onClick={() => onSelect(filter.value)}
            aria-pressed={active}
          >
            <HStack gap={1.5}>
              <Text>{filter.label}</Text>
              <Text color="fg.muted" fontVariantNumeric="tabular-nums">
                {counts[filter.value]}
              </Text>
            </HStack>
          </Button>
        );
      })}
    </HStack>
  );
}

function HolderKindBadge({ holder }: { holder: Holder }) {
  if (holder.kind === "person") return null;

  const isGroup = holder.kind === "group";
  const Icon = isGroup ? Users : KeyRound;

  return (
    <HStack gap={2}>
      <Box color="fg.muted" display="flex" alignItems="center">
        <Icon size={12} aria-hidden />
      </Box>
      <Badge size="sm" variant="surface" colorPalette="gray">
        {isGroup ? "Group" : "API key"}
      </Badge>
    </HStack>
  );
}
