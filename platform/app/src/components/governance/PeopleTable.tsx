import {
  Badge,
  Box,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Lock } from "lucide-react";
import numeral from "numeral";
import { UserAvatar } from "~/components/UserAvatar";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import {
  explainHandledError,
  HandledErrorAlert,
  readHandledError,
} from "~/features/errors";
import type { SpendSortField } from "~/hooks/useSpendSortParam";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

export type SpendByUserRow =
  RouterOutputs["activityMonitor"]["spendByUser"][number];
type Department = RouterOutputs["departments"]["list"][number];
type DepartmentAssignments = RouterOutputs["departments"]["assignments"];
type IngestionSource = RouterOutputs["ingestionSources"]["list"][number];

/** The window every per-person figure on this table is measured over. */
export const PEOPLE_WINDOW_DAYS = 30;
export const PEOPLE_WINDOW_LABEL = `Last ${PEOPLE_WINDOW_DAYS} days`;

export const PEOPLE_EMPTY_COPY =
  "No one has used AI through a connected source in the last 30 days.";

export const SPEND_SORT_LABEL: Record<SpendSortField, string> = {
  spend: "spend",
  requests: "requests",
  lastActivity: "last activity",
};

/*
 * Formatting
 */

export const formatUsd = (n: number | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v === 0 ? "$0.00" : numeral(v).format("$0,0.00");
};

/**
 * "3 days ago", spelled out. A shortened unit ("3d") saves pixels and costs
 * the reader a guess (copywriting.md).
 */
export const formatRelativeTime = (
  date: Date | string | null,
  nowMs = Date.now(),
): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = nowMs - d.getTime();
  if (diffMs < 0) return "just now";
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return plural(min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return plural(hr, "hour");
  const days = Math.floor(hr / 24);
  return plural(days, "day");
};

/**
 * How a row names its person. An actor is the email the gateway saw, or a
 * user id when it saw none: an email shows its local part as the name with
 * the full address under it; anything else shows as-is.
 */
export function describePerson(actor: string): {
  primary: string;
  secondary: string | null;
  avatarName: string;
} {
  const at = actor.indexOf("@");
  if (at > 0) {
    const local = actor.slice(0, at);
    return {
      primary: local,
      secondary: actor,
      // "jane.doe" reads as two words for the initials, not one.
      avatarName: local.replace(/[._-]+/g, " "),
    };
  }
  return { primary: actor, secondary: null, avatarName: actor };
}

/*
 * Joins
 */

/**
 * The department a spend row rolls up to, by the same join the server makes
 * for spend-by-department: the actor is the member's email, or the user id
 * when the event carried no email. No match means no department is known,
 * never a guess.
 */
export function departmentNameForActor({
  actor,
  assignments,
  departments,
}: {
  actor: string;
  assignments: DepartmentAssignments | undefined;
  departments: readonly Department[] | undefined;
}): string | null {
  if (!assignments || !departments) return null;
  const member = assignments.users.find(
    (user) => user.email === actor || user.id === actor,
  );
  if (!member?.departmentId) return null;
  return (
    departments.find((department) => department.id === member.departmentId)
      ?.name ?? null
  );
}

/**
 * The connected source a most-used target names, when it names one at all:
 * an exact match on a source's name or its type. The target is the model the
 * gateway saw most for this person, so most rows match nothing and render a
 * plain chip.
 */
export function sourceForTarget({
  target,
  sources,
}: {
  target: string | null;
  sources: readonly IngestionSource[] | undefined;
}): IngestionSource | null {
  if (!target || !sources) return null;
  const wanted = target.toLowerCase();
  return (
    sources.find(
      (source) =>
        source.name.toLowerCase() === wanted ||
        source.sourceType.toLowerCase() === wanted,
    ) ?? null
  );
}

/*
 * Sort chips
 */

/**
 * A real button with radio semantics, so the ranking's sort is reachable
 * from the keyboard and announced as a choice among three (the same
 * rationale as the teams page).
 */
function SortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 9999,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: active
          ? "var(--chakra-colors-orange-500)"
          : "var(--chakra-colors-border-muted)",
        backgroundColor: active
          ? "var(--chakra-colors-orange-50)"
          : "transparent",
        color: active
          ? "var(--chakra-colors-orange-700)"
          : "var(--chakra-colors-fg-muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function SpendSortChips({
  value,
  onChange,
  ariaLabelledBy,
}: {
  value: SpendSortField;
  onChange: (v: SpendSortField) => void;
  ariaLabelledBy?: string;
}) {
  const options: Array<{ key: SpendSortField; label: string }> = [
    { key: "spend", label: "Spend" },
    { key: "requests", label: "Requests" },
    { key: "lastActivity", label: "Last active" },
  ];
  return (
    <HStack gap={1} role="radiogroup" aria-labelledby={ariaLabelledBy}>
      {options.map((option) => (
        <SortChip
          key={option.key}
          label={option.label}
          active={option.key === value}
          onClick={() => onChange(option.key)}
        />
      ))}
    </HStack>
  );
}

/*
 * The panel: query, chips, window label, and the table or its substitute
 */

/**
 * Everyone who used AI through a connected source in the window, ranked.
 * Mount only for a viewer holding `activityMonitor:view`, which is the
 * grant `spendByUser` asks for; the caller renders the permission notice
 * otherwise. Department and source reads are optional joins: the panel
 * renders without them, and `canReadSources` keeps the sources query off
 * for a viewer who cannot hold it.
 */
export function PeopleSpendPanel({
  orgId,
  sortBy,
  onSortChange,
  canReadSources,
}: {
  orgId: string;
  sortBy: SpendSortField;
  onSortChange: (next: SpendSortField) => void;
  canReadSources: boolean;
}) {
  const peopleQuery = api.activityMonitor.spendByUser.useQuery(
    {
      organizationId: orgId,
      windowDays: PEOPLE_WINDOW_DAYS,
      limit: 500,
      sortBy,
      sortDir: "desc",
    },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const departmentsQuery = api.departments.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const assignmentsQuery = api.departments.assignments.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && canReadSources, refetchOnWindowFocus: false },
  );

  const people = peopleQuery.data ?? [];
  const lockedByPlan =
    readHandledError(peopleQuery.error)?.code === "enterprise_plan_required";

  return (
    <VStack align="stretch" gap={3} width="full">
      <HStack justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Text fontSize="xs" color="fg.muted">
          {PEOPLE_WINDOW_LABEL}
        </Text>
        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted" id="people-sort-by-label">
            Sort by:
          </Text>
          <SpendSortChips
            value={sortBy}
            onChange={onSortChange}
            ariaLabelledBy="people-sort-by-label"
          />
        </HStack>
      </HStack>

      {lockedByPlan ? (
        <EnterpriseLockedLine />
      ) : (
        <>
          <HandledErrorAlert
            error={peopleQuery.error}
            fallbackTitle="Couldn't load people"
          />
          {peopleQuery.isLoading ? (
            <Box padding={6}>
              <Spinner />
            </Box>
          ) : people.length === 0 ? (
            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={6}
              color="fg.muted"
              fontSize="sm"
            >
              {peopleQuery.error
                ? "People's activity could not be read."
                : PEOPLE_EMPTY_COPY}
            </Box>
          ) : (
            <>
              <PeopleTable
                people={people}
                departmentFor={(actor) =>
                  departmentNameForActor({
                    actor,
                    assignments: assignmentsQuery.data,
                    departments: departmentsQuery.data,
                  })
                }
                sourceFor={(target) =>
                  sourceForTarget({ target, sources: sourcesQuery.data })
                }
              />
              <Text fontSize="xs" color="fg.muted">
                {people.length} {people.length === 1 ? "person" : "people"}{" "}
                shown.
              </Text>
            </>
          )}
        </>
      )}
    </VStack>
  );
}

/**
 * The plan refusal is expected on a non-Enterprise organization, so it
 * reads as a locked feature in the registry's words, not as a failure.
 */
function EnterpriseLockedLine() {
  const copy = explainHandledError({
    code: "enterprise_plan_required",
    meta: {},
    httpStatus: 402,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  return (
    <HStack
      role="note"
      gap={2}
      color="fg.muted"
      fontSize="sm"
      paddingY={2}
      data-testid="people-enterprise-locked"
    >
      <Lock size={14} aria-hidden="true" />
      <Text>
        {copy.title}
        {copy.description ? ` ${copy.description}` : ""}
      </Text>
    </HStack>
  );
}

/*
 * The table
 */

export function PeopleTable({
  people,
  departmentFor,
  sourceFor,
}: {
  people: readonly SpendByUserRow[];
  departmentFor: (actor: string) => string | null;
  sourceFor: (target: string | null) => IngestionSource | null;
}) {
  return (
    <ListTable size="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Person</Table.ColumnHeader>
          <Table.ColumnHeader>Department</Table.ColumnHeader>
          <Table.ColumnHeader>Most used</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Requests</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Spend</Table.ColumnHeader>
          <Table.ColumnHeader>Last active</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {people.map((person) => (
          <PersonRow
            key={person.actor}
            person={person}
            departmentName={departmentFor(person.actor)}
            source={sourceFor(person.mostUsedTarget)}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
}

function PersonRow({
  person,
  departmentName,
  source,
}: {
  person: SpendByUserRow;
  departmentName: string | null;
  source: IngestionSource | null;
}) {
  const router = useRouter();
  const href = `/governance/users/${encodeURIComponent(person.actor)}`;
  const { primary, secondary, avatarName } = describePerson(person.actor);

  return (
    <Table.Row
      cursor="pointer"
      onClick={() => void router.push(href)}
      _hover={{ backgroundColor: "bg.subtle" }}
    >
      <Table.Cell>
        <HStack gap={3}>
          <UserAvatar name={avatarName} size="xs" />
          <VStack align="start" gap={0} minWidth={0}>
            <Link
              href={href}
              fontWeight="semibold"
              color="fg"
              onClick={(event) => event.stopPropagation()}
            >
              {primary}
            </Link>
            {secondary && (
              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                {secondary}
              </Text>
            )}
          </VStack>
        </HStack>
      </Table.Cell>
      <Table.Cell color={departmentName ? "fg" : "fg.muted"}>
        {departmentName ?? "—"}
      </Table.Cell>
      <Table.Cell>
        {person.mostUsedTarget ? (
          source ? (
            <Link
              href={`/governance/inventory/${encodeURIComponent(source.id)}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Badge size="sm" variant="surface" colorPalette="blue">
                {person.mostUsedTarget}
              </Badge>
            </Link>
          ) : (
            <Badge size="sm" variant="surface">
              {person.mostUsedTarget}
            </Badge>
          )
        ) : (
          <Text color="fg.muted">—</Text>
        )}
      </Table.Cell>
      <Table.Cell textAlign="end">
        {numeral(person.requests).format("0,0")}
      </Table.Cell>
      <Table.Cell textAlign="end" fontWeight="semibold">
        {formatUsd(person.spendUsd)}
      </Table.Cell>
      <Table.Cell color="fg.muted">
        {formatRelativeTime(person.lastActivityIso)}
      </Table.Cell>
    </Table.Row>
  );
}
