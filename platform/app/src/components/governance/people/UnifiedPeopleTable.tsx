import { Badge, Button, HStack, Table, Text, VStack } from "@chakra-ui/react";
import { SOURCE_TYPE_LABEL } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import { MATCH_EVIDENCE_KIND } from "@ee/governance/services/logic/identityEvidence";
import { MoreVertical } from "lucide-react";
import numeral from "numeral";

import {
  describePerson,
  formatRelativeTime,
  formatUsd,
} from "~/components/governance/PeopleTable";
import { UserAvatar } from "~/components/UserAvatar";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import type { RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

import { SPEND_WINDOW_LABEL } from "./peopleFilters";
import type { PeopleRow, PersonMatchStatus } from "./peopleRows";

type IngestionSource = RouterOutputs["ingestionSources"]["list"][number];

/**
 * One table for everyone: the people the gateway metered and the people the
 * pull sources named, joined by `mergePeopleRows` and rendered here.
 *
 * A figure that was never measured renders as a dash, never as zero. A person
 * the providers named but nothing metered has no spend — saying `$0.00` would
 * claim we looked and found none.
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

/**
 * The proof column's words, for humans rather than for the enum — keyed off the
 * engine's own vocabulary so a kind added there fails the build here instead of
 * silently rendering its slug.
 */
const EVIDENCE_LABEL: Record<string, string> = {
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL]: "confirmed address",
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID]:
    "confirmed address and directory",
  [MATCH_EVIDENCE_KIND.DIRECTORY_ID]: "directory identifier",
  [MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED]: "confirmed by a person",
} satisfies Record<
  (typeof MATCH_EVIDENCE_KIND)[keyof typeof MATCH_EVIDENCE_KIND],
  string
>;

/**
 * The provider's own name where we have one, its identifier where we do not.
 *
 * Some of the catalog's labels carry a parenthetical qualifier — "Claude Code
 * (Anthropic OAuth)", "Anthropic Claude (Cowork)". That qualifier tells an
 * administrator which connector to pick on the inventory screen; on a person's
 * row it is extra words about a source they did not choose, and it is what
 * pushed the badge onto a line of its own and made one row twice the height of
 * its neighbours. Dropping it shortens the label without abbreviating any word
 * in it.
 *
 * The Anthropic Admin API label used to be the worst of these ("...(usage &
 * cost)") and no longer is: it names the product now, and which report a
 * source pulls is asked in the composer. The trim stays for the rest.
 */
export function providerLabel(provider: string): string {
  const label =
    SOURCE_TYPE_LABEL[provider as keyof typeof SOURCE_TYPE_LABEL] ?? provider;
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

/**
 * A column heading over a figure the spend read measured, with the window it
 * measured over under it.
 *
 * The window belongs here rather than in a note beneath the table: it is true
 * of these two columns and of nothing else on the row, and a reader wondering
 * what "$412.40" covers is looking at the column, not at the last line of the
 * card. The two headings both carry it because the two figures are both
 * windowed, and one of them saying so would leave the other ambiguous.
 */
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
  sourceFor: (target: string | null) => IngestionSource | null;
  /** Omitted for a reader without the manage grant; no row action is offered. */
  onAssignDepartment?: (row: PeopleRow) => void;
}) {
  // The action column exists only when some row can actually use it. A manager
  // looking at a table where nobody is linked to an account would otherwise get
  // a narrow empty column with a header and no contents.
  const assignable =
    onAssignDepartment && rows.some((row) => row.linkedUserId !== null)
      ? onAssignDepartment
      : undefined;

  return (
    // Fixed layout, because the widest thing on this screen is a machine
    // login's opaque identifier and an automatic table would let that one
    // string set the width of the whole Person column - pushing the table past
    // its container, which clips rather than scrolls. Fixed widths make the
    // identifier give way instead: it truncates, and every column stays where
    // the reader last saw it.
    <ListTable
      size="sm"
      tableLayout="fixed"
      width="full"
      // Below this the Person column stops being able to hold a name, an
      // identifier and a badge at once, and the badges shrink to unreadable
      // slivers. The card scrolls instead: a reader on a narrow window drags
      // the table sideways, which is ordinary, rather than reading a row that
      // has been shredded to fit. At 1280 the table is wider than this floor,
      // so nothing scrolls.
      minWidth="62rem"
      containerProps={{ overflowX: "auto" }}
    >
      <Table.Header>
        <Table.Row>
          {/* Person takes whatever the others leave, because it is the column
              that can use more room and the only one that degrades gracefully
              when it has less. */}
          <Table.ColumnHeader>Person</Table.ColumnHeader>
          <Table.ColumnHeader width="9.5rem">Department</Table.ColumnHeader>
          {/* The measured columns are sized in rem rather than in percent: a
              percentage of a narrow window left "$412.40" broken across two
              lines as "$412.4" and "0", which is not a smaller figure but a
              different one. These widths hold a five-figure amount, and the
              window note under each heading on one line. */}
          <Table.ColumnHeader width="7.5rem" textAlign="end">
            <MeasuredHeading>Spend</MeasuredHeading>
          </Table.ColumnHeader>
          <Table.ColumnHeader width="7.5rem" textAlign="end">
            <MeasuredHeading>Requests</MeasuredHeading>
          </Table.ColumnHeader>
          <Table.ColumnHeader width="7.25rem">Last active</Table.ColumnHeader>
          {/* Wide enough for a badge over a member's name; the width freed by
              not repeating that name goes to the Person column, where the
              identifiers are. */}
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

/**
 * Where a person's own page lives, for the rows that have one.
 *
 * A row that only the pull sources named has no actor to address, so there is
 * nothing to link to and the row is not clickable.
 */
function personHref(row: PeopleRow): string | null {
  return row.actor
    ? `/governance/users/${encodeURIComponent(row.actor)}`
    : null;
}

/**
 * The two names a row is shown under: the one printed on the line, and the one
 * the avatar takes its initials from.
 *
 * A spend row is named by its actor, so the address reads better split into a
 * local part and the address under it. A discovered person already has a
 * display name the provider or the directory gave them.
 */
function personNames(row: PeopleRow): { primary: string; avatarName: string } {
  const described =
    row.provider === null ? describePerson(row.displayName) : null;
  return {
    primary: described?.primary ?? row.displayName,
    avatarName: described?.avatarName ?? row.displayName,
  };
}

/**
 * Who we decided the account is, and what proved it, as one phrase, because
 * the status cell holds one line. The name is dropped when it is the name
 * already on the row: repeating it costs the width the evidence needs, and
 * "Priya Raman · confirmed address" next to a row headed Priya Raman told
 * the reader one thing twice and then ran out of room to say the other.
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

/**
 * One person, one row.
 *
 * The cells are components of their own rather than one long body. Each of
 * them answers a different question about the person — who they are, which
 * department they sit in, what they spent, whether we know who they are — and
 * reading the row as that short list of questions is what keeps it legible
 * once a column's rules for giving way get long.
 */
function PersonRow({
  row,
  source,
  onAssignDepartment,
}: {
  row: PeopleRow;
  source: IngestionSource | null;
  onAssignDepartment?: (row: PeopleRow) => void;
}) {
  const router = useRouter();
  const href = personHref(row);
  const { primary, avatarName } = personNames(row);
  const matchDetail = matchSummary({ row, primary });

  return (
    <Table.Row
      cursor={href ? "pointer" : undefined}
      onClick={href ? () => void router.push(href) : undefined}
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

/**
 * The Person column: the avatar, the name, the badges that qualify it, and the
 * identity line underneath.
 *
 * It stands on its own because it is the only cell that has to hold four
 * things at once inside a fixed width, so nearly everything in it is a
 * decision about what gives way first when there is not enough room.
 */
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
  source: IngestionSource | null;
}) {
  return (
    <Table.Cell overflow="hidden">
      <HStack gap={3} align="start" minWidth={0}>
        <UserAvatar name={avatarName} size="xs" flexShrink={0} />
        {/* Two lines' worth of box whether or not there is a second line. An
            erased person has no identifier to show, and without this their
            row sits shorter than its neighbours and reads as a break in the
            table. */}
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

/**
 * The department the person belongs to, or a dash while nobody has said.
 *
 * The dash is muted and a real department is not, so a reader sweeping the
 * column sees the gaps without having to read every row.
 */
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

/**
 * Whether we know whose account this is, and under it the short phrase saying
 * what settled the question.
 */
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
 * The row's overflow menu.
 *
 * The cell is rendered even for a person who has no menu to offer, because a
 * missing cell would pull every column after it one place to the left on that
 * row while its neighbours stayed put.
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
 * The line under the name: who the provider called them, and where the money
 * went most.
 *
 * An erased person has neither an identifier nor a provider here, by
 * construction in `mergePeopleRows` — the row is described by its stand-in and
 * nothing else.
 */
function PersonIdentityLine({
  row,
  primary,
  source,
}: {
  row: PeopleRow;
  /** The name already on the line above, so it is not repeated underneath. */
  primary: string;
  source: IngestionSource | null;
}) {
  const showsIdentifier = row.identifier !== null && row.identifier !== primary;

  if (!showsIdentifier && row.provider === null && !row.mostUsedTarget) {
    return null;
  }

  return (
    // One line, always. Wrapping put a long provider badge on a line of its own
    // and made that row twice the height of its neighbours, which reads as a
    // section break where there is none. The identifier is what gives way: it
    // shrinks and truncates, and the badges keep their width.
    <HStack gap={2} flexWrap="nowrap" overflow="hidden" maxWidth="full">
      {showsIdentifier && (
        <Text
          fontSize="xs"
          color="fg.muted"
          truncate
          // A floor, so a 36-character machine identifier shrinks to its first
          // few characters rather than to nothing. An identifier truncated away
          // entirely leaves the row with no identity at all, which is worse
          // than a partial one the reader can hover to read in full.
          minWidth="4.5rem"
          // First to give way, and by a wide margin: an address the reader can
          // finish in their head costs less than a provider's name cut down to
          // "Seen at OpenAI A...", where the shortening removes the only thing
          // the badge is there to say.
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
 * A badge that shortens itself rather than being sliced by the edge of its
 * cell.
 *
 * A badge is a flex container, so the ellipsis has to live on a span inside it:
 * put `textOverflow` on the badge and the text is cut with no ellipsis at all,
 * which reads as a rendering fault rather than as a shortened name. `shrink`
 * sets how readily this badge gives way next to the others on its line — the
 * most-used chip is context and yields first, the provider is identity and
 * holds on.
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
