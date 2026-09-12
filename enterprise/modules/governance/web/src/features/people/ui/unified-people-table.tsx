// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Badge, Button, HStack, Table, Text, VStack } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import numeral from "numeral";

import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";

import { useGovernanceRouter } from "../../../behavior/governance-router.ts";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { UserAvatar } from "../../../ui/elements/user-avatar.tsx";
import { SOURCE_TYPE_LABEL } from "../../ingestion-sources/model/ingestion-source-catalog.ts";
import type { GovernanceIngestionSourceView } from "../../../behavior/governance-api.ts";
import { MATCH_EVIDENCE_KIND } from "../model/match-evidence-kind.ts";
import { SPEND_WINDOW_LABEL } from "../model/people-filters.ts";
import { describePerson, formatRelativeTime, formatUsd } from "./people-table.tsx";
import type { PeopleRow, PersonMatchStatus } from "../model/people-rows.ts";

/**
 * One table for everyone: the people the gateway metered and the people the
 * pull sources named, joined by `mergePeopleRows` and rendered here. A
 * figure that was never measured renders as a dash, never as zero.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 */

const STATUS_LABEL: Record<PersonMatchStatus, string> = {
  matched: "Matched",
  unmatched: "Unmatched",
  erased: "Erased",
};

const STATUS_PALETTE: Record<PersonMatchStatus, string> = {
  matched: "green",
  unmatched: "gray",
  erased: "purple",
};

/** The proof column's words, keyed off the engine's own vocabulary. */
const EVIDENCE_LABEL: Record<string, string> = {
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL]: "confirmed address",
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID]:
    "confirmed address and directory",
  [MATCH_EVIDENCE_KIND.DIRECTORY_ID]: "directory identifier",
  [MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED]: "confirmed by a person",
};

/**
 * The provider's own name where we have one, its identifier where we do not,
 * with the catalog's parenthetical qualifier dropped — three extra words
 * about a source the person did not choose, and no room for it on a row.
 */
export function providerLabel(provider: string): string {
  const label =
    SOURCE_TYPE_LABEL[provider as keyof typeof SOURCE_TYPE_LABEL] ?? provider;
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

function MeasuredHeading({ children }: { children: string }) {
  return (
    <VStack align="end" gap={0}>
      <Text as="span">{children}</Text>
      <Text
        as="span"
        fontSize="10px"
        fontWeight="normal"
        color="fg.subtle"
        textTransform="none"
        letterSpacing="normal"
        whiteSpace="nowrap"
      >
        {SPEND_WINDOW_LABEL}
      </Text>
    </VStack>
  );
}

const notMeasured = (
  <Text color="fg.muted" aria-label="not measured">
    —
  </Text>
);

export function UnifiedPeopleTable({
  rows,
  sourceFor,
  onAssignDepartment,
}: {
  rows: readonly PeopleRow[];
  sourceFor: (target: string | null) => GovernanceIngestionSourceView | null;
  /** Omitted for a reader without the manage grant; no row action is offered. */
  onAssignDepartment?: (row: PeopleRow) => void;
}) {
  // The action column exists only when some row can actually use it.
  const assignable =
    onAssignDepartment && rows.some((row) => row.linkedUserId !== null)
      ? onAssignDepartment
      : undefined;

  return (
    // Fixed layout: a machine login's opaque identifier would otherwise set
    // the width of the whole Person column.
    <ListTable
      size="sm"
      tableLayout="fixed"
      width="full"
      minWidth="62rem"
      containerProps={{ overflowX: "auto" }}
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Person</Table.ColumnHeader>
          <Table.ColumnHeader width="9.5rem">Department</Table.ColumnHeader>
          <Table.ColumnHeader width="7.5rem" textAlign="end">
            <MeasuredHeading>Spend</MeasuredHeading>
          </Table.ColumnHeader>
          <Table.ColumnHeader width="7.5rem" textAlign="end">
            <MeasuredHeading>Requests</MeasuredHeading>
          </Table.ColumnHeader>
          <Table.ColumnHeader width="7.25rem">Last active</Table.ColumnHeader>
          <Table.ColumnHeader width="10rem">Status</Table.ColumnHeader>
          {assignable && (
            <Table.ColumnHeader width="4rem" textAlign="end">
              Actions
            </Table.ColumnHeader>
          )}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <PersonRow
            key={row.key}
            row={row}
            source={sourceFor(row.mostUsedTarget)}
            onAssignDepartment={assignable}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** Where a person's own page lives, for the rows that have one. */
function personHref(row: PeopleRow): string | null {
  return row.actor
    ? `/governance/users/${encodeURIComponent(row.actor)}`
    : null;
}

/** The two names a row is shown under: printed, and the avatar's initials. */
function personNames(row: PeopleRow): { primary: string; avatarName: string } {
  const described =
    row.provider === null ? describePerson(row.displayName) : null;
  return {
    primary: described?.primary ?? row.displayName,
    avatarName: described?.avatarName ?? row.displayName,
  };
}

/**
 * Who we decided the account is, and what proved it, as one phrase. The name
 * is dropped when it repeats the row's own name.
 */
function matchSummary({
  row,
  primary,
}: {
  row: PeopleRow;
  /** The name already on the row, so the phrase does not repeat it. */
  primary: string;
}): string | null {
  const memberName =
    row.matchDetail && row.matchDetail !== primary ? row.matchDetail : null;
  const evidence = row.evidenceKind
    ? (EVIDENCE_LABEL[row.evidenceKind] ?? row.evidenceKind)
    : null;
  return [memberName, evidence].filter(Boolean).join(" · ") || null;
}

/** One person, one row, its cells split out by what each one answers. */
function PersonRow({
  row,
  source,
  onAssignDepartment,
}: {
  row: PeopleRow;
  source: GovernanceIngestionSourceView | null;
  onAssignDepartment?: (row: PeopleRow) => void;
}) {
  const router = useGovernanceRouter();
  const href = personHref(row);
  const { primary, avatarName } = personNames(row);
  const matchDetail = matchSummary({ row, primary });

  return (
    <Table.Row
      cursor={href ? "pointer" : undefined}
      onClick={href ? () => router.push(href) : undefined}
      _hover={href ? { backgroundColor: "bg.subtle" } : undefined}
    >
      <PersonNameCell
        row={row}
        href={href}
        primary={primary}
        avatarName={avatarName}
        source={source}
      />

      <PersonDepartmentCell row={row} />

      <Table.Cell textAlign="end" fontWeight="semibold" whiteSpace="nowrap">
        {row.spendUsd === null ? notMeasured : formatUsd(row.spendUsd)}
      </Table.Cell>

      <Table.Cell textAlign="end" whiteSpace="nowrap">
        {row.requests === null
          ? notMeasured
          : numeral(row.requests).format("0,0")}
      </Table.Cell>

      <Table.Cell color="fg.muted" whiteSpace="nowrap">
        {row.lastActiveIso === null
          ? notMeasured
          : formatRelativeTime(row.lastActiveIso)}
      </Table.Cell>

      <PersonStatusCell row={row} matchDetail={matchDetail} />

      {onAssignDepartment && (
        <PersonActionsCell
          row={row}
          primary={primary}
          onAssignDepartment={onAssignDepartment}
        />
      )}
    </Table.Row>
  );
}

/** The Person column: avatar, name, qualifying badges, identity line under it. */
function PersonNameCell({
  row,
  href,
  primary,
  avatarName,
  source,
}: {
  row: PeopleRow;
  /** Null for a person with no page of their own; the name renders unlinked. */
  href: string | null;
  primary: string;
  avatarName: string;
  source: GovernanceIngestionSourceView | null;
}) {
  return (
    <Table.Cell overflow="hidden">
      <HStack gap={3} align="start" minWidth={0}>
        <UserAvatar name={avatarName} size="xs" flexShrink={0} />
        {/* Two lines' worth of box whether or not there is a second line, so
            an erased row (no identifier) sits as tall as its neighbours. */}
        <VStack
          align="start"
          gap={0.5}
          minWidth={0}
          maxWidth="full"
          minHeight="2.625rem"
          justify="center"
        >
          <HStack gap={2} flexWrap="nowrap" maxWidth="full" overflow="hidden">
            {href ? (
              <Link
                href={href}
                fontWeight="semibold"
                color="fg"
                truncate
                minWidth="5rem"
                title={primary}
                onClick={(event) => event.stopPropagation()}
              >
                {primary}
              </Link>
            ) : (
              <Text
                fontWeight="semibold"
                truncate
                minWidth="5rem"
                title={primary}
              >
                {primary}
              </Text>
            )}
            {row.isMachine && (
              <ShrinkingBadge label="machine login" colorPalette="gray" />
            )}
            {row.needsReview && (
              <ShrinkingBadge
                label="needs review"
                colorPalette="yellow"
                title={row.suspendedReason ?? undefined}
              />
            )}
          </HStack>
          <PersonIdentityLine row={row} primary={primary} source={source} />
        </VStack>
      </HStack>
    </Table.Cell>
  );
}

/** The department the person belongs to, or a muted dash while nobody has said. */
function PersonDepartmentCell({ row }: { row: PeopleRow }) {
  return (
    <Table.Cell
      color={row.department ? "fg" : "fg.muted"}
      truncate
      title={row.department ?? undefined}
    >
      {row.department ?? "—"}
    </Table.Cell>
  );
}

/** Whether we know whose account this is, and the phrase that settled it. */
function PersonStatusCell({
  row,
  matchDetail,
}: {
  row: PeopleRow;
  /** Null when there is nothing to add beyond the status word itself. */
  matchDetail: string | null;
}) {
  return (
    <Table.Cell>
      <VStack align="start" gap={0}>
        <Badge size="sm" colorPalette={STATUS_PALETTE[row.status]}>
          {STATUS_LABEL[row.status]}
        </Badge>
        {matchDetail && (
          <Text
            fontSize="xs"
            color="fg.muted"
            lineClamp={1}
            title={matchDetail}
          >
            {matchDetail}
          </Text>
        )}
      </VStack>
    </Table.Cell>
  );
}

/**
 * The row's overflow menu. Rendered even with nothing to offer, so the
 * column after it does not shift on rows that have no action.
 */
function PersonActionsCell({
  row,
  primary,
  onAssignDepartment,
}: {
  row: PeopleRow;
  /** Named in the trigger's label, so a screen reader says whose menu it is. */
  primary: string;
  onAssignDepartment: (row: PeopleRow) => void;
}) {
  return (
    <Table.Cell textAlign="end">
      {row.linkedUserId && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Actions for ${primary}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="assign-department"
              onClick={(event) => {
                event.stopPropagation();
                onAssignDepartment(row);
              }}
            >
              Assign department
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      )}
    </Table.Cell>
  );
}

/**
 * The line under the name: who the provider called them, and where the
 * money went most. Empty for an erased person, by construction upstream.
 */
function PersonIdentityLine({
  row,
  primary,
  source,
}: {
  row: PeopleRow;
  /** The name already on the line above, so it is not repeated underneath. */
  primary: string;
  source: GovernanceIngestionSourceView | null;
}) {
  const showsIdentifier = row.identifier !== null && row.identifier !== primary;

  if (!showsIdentifier && row.provider === null && !row.mostUsedTarget) {
    return null;
  }

  return (
    // One line, always: wrapping put a long provider badge on its own line
    // and doubled that row's height. The identifier gives way first.
    <HStack gap={2} flexWrap="nowrap" overflow="hidden" maxWidth="full">
      {showsIdentifier && (
        <Text
          fontSize="xs"
          color="fg.muted"
          truncate
          minWidth="4.5rem"
          flexShrink={20}
          title={row.identifier ?? undefined}
        >
          {row.identifier}
        </Text>
      )}
      {row.provider !== null &&
        (row.status === "unmatched" ? (
          <ShrinkingBadge
            label={`Seen at ${providerLabel(row.provider)}`}
            variant="surface"
            colorPalette="gray"
          />
        ) : (
          <Text
            fontSize="xs"
            color="fg.muted"
            flexShrink={0}
            whiteSpace="nowrap"
          >
            {providerLabel(row.provider)}
          </Text>
        ))}
      {row.mostUsedTarget &&
        (source ? (
          <Link
            href={`/governance/inventory/${encodeURIComponent(source.id)}`}
            onClick={(event) => event.stopPropagation()}
            minWidth={0}
            overflow="hidden"
          >
            <ShrinkingBadge
              label={row.mostUsedTarget}
              variant="surface"
              colorPalette="blue"
              shrink={4}
            />
          </Link>
        ) : (
          <ShrinkingBadge
            label={row.mostUsedTarget}
            variant="surface"
            shrink={4}
          />
        ))}
    </HStack>
  );
}

/**
 * A badge that shortens itself rather than being sliced by its cell's edge.
 * `shrink` sets how readily it gives way next to its neighbours.
 */
function ShrinkingBadge({
  label,
  colorPalette,
  variant,
  title,
  shrink = 1,
}: {
  label: string;
  colorPalette?: string;
  variant?: "surface";
  title?: string;
  shrink?: number;
}) {
  return (
    <Badge
      size="sm"
      variant={variant}
      colorPalette={colorPalette}
      minWidth={0}
      flexShrink={shrink}
      overflow="hidden"
      title={title ?? label}
    >
      <Text as="span" truncate minWidth={0}>
        {label}
      </Text>
    </Badge>
  );
}
