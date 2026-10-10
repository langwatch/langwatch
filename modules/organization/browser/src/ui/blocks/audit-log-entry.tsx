/** One audit table entry (a run of identical events): its row, then one full-width detail. */

import type { WireOf } from "@langwatch/api/web";
import { UserAvatar } from "@langwatch/design-system/avatar";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { InlineCode } from "@langwatch/design-system/inline-code";
import {
  Badge,
  Box,
  Button,
  Grid,
  HStack,
  IconButton,
  SimpleGrid,
  Table,
  Text,
  VisuallyHidden,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  KeyRound,
  Settings,
  UserX,
  VenetianMask,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import {
  auditActionPhrase,
  auditActor,
  auditChangeSummary,
  auditClient,
  type AuditActor,
  type AuditRun,
} from "../../model/audit-log-rows.ts";
import { Link } from "../elements/organization-link.tsx";

type EnrichedAuditLog = WireOf<StoredEnrichedAuditLog>;

/** Fixed widths; Event takes what is left. The table's minimum keeps Event at 280px. */
export const AUDIT_TABLE_COLUMNS = [
  { label: "Time", width: "112px" },
  { label: "Actor", width: "224px" },
  { label: "Event", width: void 0 },
  { label: "Via", width: "72px" },
  { label: "Project", width: "136px" },
  { label: "Source", width: "152px" },
  { label: "Details", width: "52px" },
] as const;
export const AUDIT_TABLE_MIN_WIDTH = "1028px";

const CELL = {
  verticalAlign: "middle",
  lineHeight: "20px",
  height: "56px",
  paddingY: "8px",
  paddingX: "12px",
} as const;
const EDGES = {
  "& > td:first-of-type": { paddingLeft: "16px" },
  "& > td:last-of-type": { paddingX: "12px" },
} as const;
const ROW_CELLS = { "& > td": CELL, ...EDGES } as const;
/** An open row drops its rule into the detail below; the cell layout stays whole. */
const OPEN_ROW_CELLS = { "& > td": { ...CELL, borderBottomWidth: 0 }, ...EDGES } as const;
/** Field, old value, arrow, new value: the arrows land in one place. */
const CHANGE_COLUMNS = "160px minmax(0, max-content) 16px minmax(0, 1fr)";
/** The detail's left edge lines up with the Time column's text. */
const DETAIL_CELL = { "& > td": { padding: "16px" } } as const;
const LINE = "13px";
const SMALL = "12px";
const SECONDARY = { fontSize: SMALL, lineHeight: "18px" } as const;

/** `…` and the key id's last six characters: enough to tell keys apart in a row. */
function keyTail(id: string): string {
  return `…${id.slice(-6)}`;
}

/** The door the row came through; a row with neither stamp nor person is the system's. */
function viaLabel(log: Pick<EnrichedAuditLog, "channel" | "userId">): string {
  if (log.channel === "api") return "API";
  if (log.channel === "app") return "App";
  return log.userId ? "—" : "System";
}

export function AuditTableHead() {
  return (
    <Table.Header>
      <Table.Row>
        {AUDIT_TABLE_COLUMNS.map((column) => (
          <Table.ColumnHeader
            key={column.label}
            width={column.width}
            minWidth={column.width ? void 0 : "280px"}
            whiteSpace="nowrap"
            lineHeight="16px"
          >
            {column.label === "Details" ? (
              <VisuallyHidden>{column.label}</VisuallyHidden>
            ) : (
              column.label
            )}
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
  );
}

type Openness = "closed" | "detail" | "occurrences";

/** Clicks on a value the reader may want to select or follow never fold the row. */
function isInteractiveTarget(target: EventTarget): boolean {
  return target instanceof Element && target.closest("code, time, a, button") !== null;
}

export function AuditLogEntry({
  run,
  projectLabel,
}: {
  run: AuditRun<EnrichedAuditLog>;
  projectLabel: (projectId: string) => string;
}) {
  const [open, setOpen] = useState<Openness>("closed");
  const log = run.entries[0];
  const count = run.entries.length;
  const actor = auditActor(log);
  const hasDiff = log.before != null || log.after != null;
  const toggle = () => setOpen((current) => (current === "closed" ? "detail" : "closed"));
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (document.getSelection()?.toString()) return;
    toggle();
  };

  return (
    <>
      <Table.Row
        data-testid="audit-log-entry"
        cursor="pointer"
        _hover={{ bg: "bg.subtle" }}
        onClick={onRowClick}
        css={open === "closed" ? ROW_CELLS : OPEN_ROW_CELLS}
      >
        <Table.Cell>
          <Text as="span" fontSize={LINE} color="fg.muted">
            <FormattedDate value={log.createdAt} display="time" seconds />
          </Text>
        </Table.Cell>
        <Table.Cell>
          <ActorCell actor={actor} />
        </Table.Cell>
        <Table.Cell>
          <Box display="flex" flexDirection="column" gap="2px" minWidth={0}>
            <HStack gap={2} minWidth={0} height="20px">
              <Text fontSize={LINE} lineHeight="20px" fontWeight="medium" color="fg" truncate>
                {auditActionPhrase(log.action)}
              </Text>
              {log.error && (
                <Badge size="xs" variant="subtle" colorPalette="red" flexShrink={0} height="18px">
                  Failed
                </Badge>
              )}
            </HStack>
            <HStack gap={2} minWidth={0} height="18px" {...SECONDARY}>
              <InlineCode variant="neutral" flexShrink={0} maxWidth="70%">
                {log.action}
              </InlineCode>
              {log.targetId && (
                <InlineCode variant="neutral" truncate="middle" minWidth={0}>
                  {log.targetId}
                </InlineCode>
              )}
              {count > 1 && (
                <Button
                  variant="plain"
                  size="2xs"
                  height="18px"
                  minWidth={0}
                  padding={0}
                  fontSize={SMALL}
                  fontWeight="normal"
                  color="fg.muted"
                  flexShrink={0}
                  _hover={{ color: "fg", textDecoration: "underline" }}
                  onClick={() => setOpen("occurrences")}
                >
                  {count} events
                </Button>
              )}
            </HStack>
          </Box>
        </Table.Cell>
        <Table.Cell>
          <Text {...SECONDARY} color="fg.muted" truncate>
            {viaLabel(log)}
          </Text>
        </Table.Cell>
        <Table.Cell>
          {log.projectId ? (
            <Text fontSize={LINE} color="fg" truncate>
              {projectLabel(log.projectId)}
            </Text>
          ) : (
            <Text fontSize={LINE} color="fg.subtle">
              <span aria-hidden>—</span>
              <VisuallyHidden>Not recorded</VisuallyHidden>
            </Text>
          )}
        </Table.Cell>
        <Table.Cell>
          <Text fontSize={LINE} lineHeight="20px" color="fg" truncate>
            {log.source === "gateway" ? "AI Gateway" : "Platform"}
          </Text>
          <Text {...SECONDARY} fontFamily="mono" color="fg.muted" truncate>
            {log.ipAddress || "—"}
          </Text>
        </Table.Cell>
        <Table.Cell textAlign="center">
          <IconButton
            size="2xs"
            boxSize="28px"
            minWidth="28px"
            borderRadius="4px"
            variant="ghost"
            bg="transparent"
            borderWidth={0}
            boxShadow="none"
            color="fg.muted"
            _hover={{ bg: "bg.muted" }}
            aria-label={hasDiff ? "View diff" : "Details"}
            aria-expanded={open !== "closed"}
            onClick={toggle}
          >
            {open === "closed" ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </IconButton>
        </Table.Cell>
      </Table.Row>

      {open !== "closed" && (
        <Table.Row css={DETAIL_CELL}>
          <Table.Cell colSpan={AUDIT_TABLE_COLUMNS.length} bg="bg.subtle">
            <EntryDetail run={run} actor={actor} focusOccurrences={open === "occurrences"} />
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

const ICON_ACTORS = {
  system: { Icon: Settings, name: "System", hint: "A background job" },
  anonymous: { Icon: Globe, name: "Unidentified caller", hint: "A request with no credential" },
  unresolved: { Icon: UserX, name: "Unknown user", hint: "A deleted or unknown user" },
} as const;

function IconBubble({ children, palette }: { children: ReactNode; palette?: string }) {
  return (
    <Box
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      boxSize="5"
      flexShrink={0}
      borderRadius="full"
      bg={palette ? `${palette}.subtle` : "bg.emphasized"}
      color={palette ? `${palette}.fg` : "fg.muted"}
    >
      {children}
    </Box>
  );
}

function ActorName({ name, hint }: { name: string; hint?: string | null }) {
  return (
    <Tooltip content={hint}>
      <Text fontSize={LINE} lineHeight="20px" fontWeight="medium" color="fg" truncate>
        {name}
      </Text>
    </Tooltip>
  );
}

/** A 20px mark beside the actor's one or two lines, centred on the whole block. */
function ActorRow({
  mark,
  name,
  hint,
  second,
}: {
  mark: ReactNode;
  name: string;
  hint?: string | null;
  second?: ReactNode;
}) {
  return (
    <HStack gap={2} minWidth={0} alignItems="center">
      {mark}
      <Box minWidth={0}>
        <ActorName name={name} hint={hint} />
        {second}
      </Box>
    </HStack>
  );
}

function SecondLine({
  children,
  hint,
  mono,
}: {
  children: string;
  hint?: string | null;
  mono?: boolean;
}) {
  return (
    <Tooltip content={hint}>
      <Text {...SECONDARY} color="fg.muted" fontFamily={mono ? "mono" : void 0} truncate>
        {children}
      </Text>
    </Tooltip>
  );
}

function ActorCell({ actor }: { actor: AuditActor }) {
  if (actor.kind === "user") {
    return (
      <ActorRow
        mark={<UserAvatar size="2xs" boxSize="5" fontSize="2xs" name={actor.name} flexShrink={0} />}
        name={actor.name}
        hint={actor.email}
        second={
          actor.viaKeyId && (
            <SecondLine
              hint={actor.viaKeyId}
            >{`via API key ${keyTail(actor.viaKeyId)}`}</SecondLine>
          )
        }
      />
    );
  }
  if (actor.kind === "apiKey") {
    return (
      <ActorRow
        mark={
          <IconBubble>
            <KeyRound size={12} />
          </IconBubble>
        }
        name="API key"
        hint="A service key acting as no person"
        second={
          <SecondLine hint={actor.id} mono>
            {keyTail(actor.id)}
          </SecondLine>
        }
      />
    );
  }
  if (actor.kind === "impersonation") {
    return (
      <ActorRow
        mark={
          <IconBubble palette="orange">
            <VenetianMask size={12} aria-label="Impersonation" />
          </IconBubble>
        }
        name={actor.operator.name}
        hint={actor.operator.email}
        second={<SecondLine hint={actor.subject.email}>{`as ${actor.subject.name}`}</SecondLine>}
      />
    );
  }
  const { Icon, name, hint } = ICON_ACTORS[actor.kind];
  return (
    <ActorRow
      mark={
        <IconBubble>
          <Icon size={12} />
        </IconBubble>
      }
      name={name}
      hint={hint}
    />
  );
}

function actorFacts(actor: AuditActor): string {
  if (actor.kind === "user") {
    const who = actor.email ?? actor.name;
    return actor.viaKeyId ? `${who} via API key ${actor.viaKeyId}` : who;
  }
  if (actor.kind === "apiKey") return `API key ${actor.id}`;
  if (actor.kind === "impersonation") {
    return `${actor.operator.email ?? actor.operator.name} as ${actor.subject.email ?? actor.subject.name}`;
  }
  if (actor.kind === "unresolved") return `Unknown user (${actor.id})`;
  return ICON_ACTORS[actor.kind].name;
}

/** A value that truncates with its full text a hover away. */
function Value({ children, mono }: { children: string; mono?: boolean }) {
  return (
    <Text truncate title={children} fontFamily={mono ? "mono" : void 0} color="fg">
      {children}
    </Text>
  );
}

function Client({ userAgent }: { userAgent: string | null }) {
  if (!userAgent) return <Value>—</Value>;
  return (
    <Tooltip content={userAgent}>
      <Text truncate color="fg" title={userAgent}>
        {auditClient(userAgent)}
      </Text>
    </Tooltip>
  );
}

function EntryDetail({
  run,
  actor,
  focusOccurrences,
}: {
  run: AuditRun<EnrichedAuditLog>;
  actor: AuditActor;
  focusOccurrences: boolean;
}) {
  const log = run.entries[0];
  const occurrencesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOccurrences) occurrencesRef.current?.focus();
  }, [focusOccurrences]);

  const hasDiff = log.before != null || log.after != null;
  const summary = auditChangeSummary({ before: log.before, after: log.after, limit: 50 });
  const facts: { label: string; value: ReactNode }[] = [
    {
      label: "Time",
      value: (
        <Text truncate color="fg">
          <FormattedDate value={log.createdAt} display="datetime" seconds showZone />
        </Text>
      ),
    },
    { label: "Actor", value: <Value>{actorFacts(actor)}</Value> },
    { label: "Action", value: <Value mono>{log.action}</Value> },
    { label: "User agent", value: <Client userAgent={log.userAgent} /> },
    {
      label: "Target",
      value: log.targetKind && log.targetId && (
        <HStack gap={2} minWidth={0}>
          <Text color="fg" flexShrink={0}>
            {log.targetKind}
          </Text>
          <InlineCode variant="neutral" truncate="middle" fontSize={SMALL} minWidth={0}>
            {log.targetId}
          </InlineCode>
          <Link
            color="blue.fg"
            flexShrink={0}
            href={`/settings/audit-log?targetKind=${encodeURIComponent(log.targetKind)}&targetId=${encodeURIComponent(log.targetId)}`}
          >
            All events for this target
          </Link>
        </HStack>
      ),
    },
    { label: "Operator", value: log.actorUserId && <Value mono>{log.actorUserId}</Value> },
    { label: "Entry id", value: <Value mono>{log.id}</Value> },
  ];

  return (
    <Box data-testid="audit-log-detail" fontSize={SMALL} lineHeight="18px">
      <Grid
        templateColumns={{
          base: "80px minmax(0, 1fr)",
          xl: "80px minmax(0, 1fr) 80px minmax(0, 1fr)",
        }}
        columnGap={4}
        rowGap={2}
      >
        {facts
          .filter(({ value }) => value != null && value !== "")
          .map(({ label, value }) => (
            <Box key={label} display="contents">
              <Text color="fg.muted">{label}</Text>
              <Box minWidth={0}>{value}</Box>
            </Box>
          ))}
      </Grid>

      {summary.changes.length > 0 && (
        <Box marginTop={4}>
          <Text color="fg.muted" marginBottom={1}>
            Changes
          </Text>
          {summary.changes.map((change) => (
            <Grid key={change.field} templateColumns={CHANGE_COLUMNS} columnGap={2}>
              <Text color="fg.muted" truncate>
                {change.field}
              </Text>
              <Text fontFamily="mono" truncate title={change.from}>
                {change.from}
              </Text>
              <Text textAlign="center" color="fg.subtle">
                →
              </Text>
              <Text fontFamily="mono" color="fg" truncate title={change.to}>
                {change.to}
              </Text>
            </Grid>
          ))}
          {summary.more > 0 && (
            <Text color="fg.muted">
              +{summary.more} {summary.more === 1 ? "field" : "fields"}
            </Text>
          )}
        </Box>
      )}

      {log.error && (
        <Box marginTop={4} data-testid="audit-log-error">
          <Text color="fg.muted" marginBottom={1}>
            Error
          </Text>
          <Text color="fg.error" fontFamily="mono" whiteSpace="pre-wrap" wordBreak="break-word">
            {log.error}
          </Text>
        </Box>
      )}

      {hasDiff ? (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} marginTop={4}>
          <JsonBlock title="Before" value={log.before} />
          <JsonBlock title="After" value={log.after} />
        </SimpleGrid>
      ) : (
        log.args != null && (
          <Box marginTop={4}>
            <JsonBlock title="Arguments" value={log.args} />
          </Box>
        )
      )}

      {run.entries.length > 1 && (
        <Box
          ref={occurrencesRef}
          tabIndex={-1}
          marginTop={4}
          outline="none"
          aria-label={`${run.entries.length} events`}
        >
          <Text color="fg.muted" marginBottom={1}>
            {run.entries.length} events
          </Text>
          {run.entries.map((occurrence) => (
            <Grid
              key={occurrence.id}
              data-testid="audit-log-occurrence"
              templateColumns="200px minmax(0, 1fr) 128px minmax(0, 1fr) 28px"
              columnGap={4}
              alignItems="center"
              minHeight="7"
              borderTopWidth="1px"
              borderColor="border.muted"
            >
              <Text color="fg" truncate>
                <FormattedDate value={occurrence.createdAt} display="datetime" seconds />
              </Text>
              <Value mono>{occurrence.id}</Value>
              <Value mono>{occurrence.ipAddress || "—"}</Value>
              <Client userAgent={occurrence.userAgent} />
              <CopyEntry log={occurrence} />
            </Grid>
          ))}
        </Box>
      )}
    </Box>
  );
}

function CopyEntry({ log }: { log: EnrichedAuditLog }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Tooltip content={copied ? "Copied" : "Copy JSON"}>
      <IconButton
        size="2xs"
        boxSize="7"
        minWidth="7"
        variant="ghost"
        color="fg.muted"
        aria-label="Copy JSON"
        onClick={() => copy(json(log))}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </Tooltip>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <CodePreview code={json(value)} language="json" filename={title} maxHeight="240px" compact />
  );
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
