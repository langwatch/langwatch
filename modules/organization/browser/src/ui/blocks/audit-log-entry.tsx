/** One audit feed entry (a run of identical events): sentence, meta line, change, failure. */

import type { WireOf } from "@langwatch/api/web";
import { UserAvatar } from "@langwatch/design-system/avatar";
import {
  Badge,
  Box,
  Button,
  Grid,
  HStack,
  SimpleGrid,
  Text,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";
import { format, formatDistanceToNow, readableDate } from "@langwatch/time";
import { CircleAlert, Globe, Network, ServerCog, UserX, VenetianMask } from "lucide-react";
import { useState, type ReactNode } from "react";

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

/** Time gutter, avatar, sentence, right edge: one grid so every entry lines up down the page. */
const ENTRY_COLUMNS = "72px 20px minmax(0, 1fr) auto";
/** Address, client, source: fixed widths so the meta lines form columns. */
const META_COLUMNS = "120px 128px 16px minmax(0, 1fr)";
/** Field, old value, arrow, new value: the arrows land in one place. */
const CHANGE_COLUMNS = "128px minmax(0, 200px) 16px minmax(0, 1fr)";

export function AuditLogEntry({
  run,
  projectLabel,
}: {
  run: AuditRun<EnrichedAuditLog>;
  projectLabel: (projectId: string) => string;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [repeatsOpen, setRepeatsOpen] = useState(false);
  const log = run.entries[0];
  const count = run.entries.length;
  const actor = auditActor(log);
  const hasDiff = log.before != null || log.after != null;
  const summary = auditChangeSummary({ before: log.before, after: log.after });

  return (
    <Grid
      templateColumns={ENTRY_COLUMNS}
      columnGap={3}
      rowGap={0.5}
      alignItems="baseline"
      paddingX={3}
      paddingY={1}
      borderRadius="md"
      _hover={{ bg: "bg.subtle" }}
      data-testid="audit-log-entry"
    >
      <EntryTime at={log.createdAt} />
      <Box alignSelf="center">
        <ActorAvatar actor={actor} />
      </Box>
      <Text fontSize="sm" lineHeight="short" minWidth={0}>
        <ActorName actor={actor} /> {lowerFirst(auditActionPhrase(log.action))}
        {log.targetId && (
          <>
            {" "}
            <Tooltip content={`${log.targetKind ?? "target"} ${log.targetId}`}>
              <Text as="span" fontWeight="semibold">
                {log.targetId}
              </Text>
            </Tooltip>
          </>
        )}
        {log.projectId && (
          <>
            {" in "}
            <Text as="span" fontWeight="semibold">
              {projectLabel(log.projectId)}
            </Text>
          </>
        )}
      </Text>
      <HStack gap={1.5} justify="end">
        {log.error && (
          <Badge size="xs" variant="subtle" colorPalette="red" gap={1}>
            <CircleAlert size={10} />
            Failed
          </Badge>
        )}
        {count > 1 && (
          <Button
            size="2xs"
            variant="subtle"
            height="5"
            minWidth="0"
            paddingX={1.5}
            fontSize="xs"
            fontVariantNumeric="tabular-nums"
            aria-expanded={repeatsOpen}
            aria-label={`Show all ${count} repeats`}
            onClick={() => setRepeatsOpen((open) => !open)}
          >
            ×{count}
          </Button>
        )}
      </HStack>

      <Indented>
        <MetaLine log={log}>
          <Text as="span" fontFamily="mono" color="fg.subtle" truncate>
            {log.action}
          </Text>
          <EntryButton onClick={() => setDetailOpen((open) => !open)} expanded={detailOpen}>
            {hasDiff ? "View diff" : "Details"}
          </EntryButton>
          <CopyEntry log={log} />
        </MetaLine>
      </Indented>

      {summary.changes.length > 0 && (
        <Indented>
          <Box fontSize="xs" color="fg.muted">
            {summary.changes.map((change) => (
              <Grid key={change.field} templateColumns={CHANGE_COLUMNS} columnGap={2}>
                <Text truncate>{change.field}</Text>
                <Text fontFamily="mono" truncate textAlign="end">
                  {change.from}
                </Text>
                <Text textAlign="center">→</Text>
                <Text fontFamily="mono" color="fg" truncate>
                  {change.to}
                </Text>
              </Grid>
            ))}
            {summary.more > 0 && (
              <Text>
                +{summary.more} {summary.more === 1 ? "field" : "fields"}
              </Text>
            )}
          </Box>
        </Indented>
      )}

      {log.error && (
        <Indented>
          <Text fontSize="xs" color="fg.error" data-testid="audit-log-error">
            {log.error}
          </Text>
        </Indented>
      )}

      {repeatsOpen &&
        run.entries.slice(1).map((repeat) => (
          <Box key={repeat.id} display="contents" data-testid="audit-log-repeat">
            <EntryTime at={repeat.createdAt} />
            <Box />
            <Indented>
              <MetaLine log={repeat}>
                <CopyEntry log={repeat} />
              </MetaLine>
            </Indented>
          </Box>
        ))}

      {detailOpen && (
        <Indented>
          <EntryDetail log={log} />
        </Indented>
      )}
    </Grid>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Spans the sentence column and the right edge, so what sits under the sentence starts with it. */
function Indented({ children }: { children: ReactNode }) {
  return (
    <Box gridColumn="3 / span 2" minWidth={0}>
      {children}
    </Box>
  );
}

function EntryTime({ at }: { at: string }) {
  const date = readableDate(at);
  return (
    <Tooltip
      content={`${format(date, "yyyy-MM-dd HH:mm:ss")} · ${formatDistanceToNow(date, { addSuffix: true })}`}
    >
      <Text
        gridColumn="1"
        fontSize="xs"
        color="fg.muted"
        textAlign="end"
        fontVariantNumeric="tabular-nums"
      >
        {format(date, "HH:mm:ss")}
      </Text>
    </Tooltip>
  );
}

function MetaLine({ log, children }: { log: EnrichedAuditLog; children: ReactNode }) {
  const client = auditClient(log.userAgent) ?? (log.userId ? "Unknown client" : "Worker");
  return (
    <Grid
      templateColumns={META_COLUMNS}
      columnGap={2}
      fontSize="xs"
      color="fg.muted"
      alignItems="center"
    >
      <Text fontFamily="mono" truncate>
        {log.ipAddress ?? "no address"}
      </Text>
      <Tooltip content={log.userAgent}>
        <Text truncate>{client}</Text>
      </Tooltip>
      <Box display="inline-flex">
        {log.source === "gateway" && (
          <Tooltip content="Recorded by the AI Gateway">
            <Box as="span" aria-label="AI Gateway" display="inline-flex">
              <Network size={12} />
            </Box>
          </Tooltip>
        )}
      </Box>
      <HStack gap={3} minWidth={0}>
        {children}
      </HStack>
    </Grid>
  );
}

function EntryButton({
  onClick,
  expanded,
  children,
}: {
  onClick: () => void;
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="plain"
      size="2xs"
      height="auto"
      padding={0}
      fontSize="xs"
      fontWeight="normal"
      color="blue.fg"
      aria-expanded={expanded}
      onClick={onClick}
      flexShrink={0}
    >
      {children}
    </Button>
  );
}

function CopyEntry({ log }: { log: EnrichedAuditLog }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <EntryButton onClick={() => copy(json(log))}>{copied ? "Copied" : "Copy JSON"}</EntryButton>
  );
}

const ICON_ACTORS = {
  system: { Icon: ServerCog, name: "System", hint: "A background job" },
  anonymous: { Icon: Globe, name: "Unidentified caller", hint: "A request with no credential" },
  unresolved: { Icon: UserX, name: "User not found", hint: "A deleted or unknown user" },
} as const;

function IconBubble({ children, palette }: { children: ReactNode; palette?: string }) {
  return (
    <Box
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      boxSize="5"
      borderRadius="full"
      bg={palette ? `${palette}.subtle` : "bg.emphasized"}
      color={palette ? `${palette}.fg` : "fg.muted"}
    >
      {children}
    </Box>
  );
}

function ActorAvatar({ actor }: { actor: AuditActor }) {
  if (actor.kind === "user") {
    return <UserAvatar size="2xs" boxSize="5" fontSize="2xs" name={actor.name} />;
  }
  if (actor.kind === "impersonation") {
    return (
      <IconBubble palette="orange">
        <VenetianMask size={11} />
      </IconBubble>
    );
  }
  const { Icon } = ICON_ACTORS[actor.kind];
  return (
    <IconBubble>
      <Icon size={11} />
    </IconBubble>
  );
}

function Bold({ children, hint }: { children: ReactNode; hint?: string | null }) {
  return (
    <Tooltip content={hint}>
      <Text as="span" fontWeight="semibold">
        {children}
      </Text>
    </Tooltip>
  );
}

function ActorName({ actor }: { actor: AuditActor }) {
  if (actor.kind === "user") return <Bold hint={actor.email}>{actor.name}</Bold>;
  if (actor.kind === "impersonation") {
    return (
      <>
        <Bold hint={actor.operator.email}>{actor.operator.name}</Bold>
        <Text as="span" color="orange.fg">
          {" as "}
        </Text>
        <Bold hint={actor.subject.email}>{actor.subject.name}</Bold>
      </>
    );
  }
  const { name, hint } = ICON_ACTORS[actor.kind];
  return <Bold hint={actor.kind === "unresolved" ? `${hint}: ${actor.id}` : hint}>{name}</Bold>;
}

function EntryDetail({ log }: { log: EnrichedAuditLog }) {
  const hasDiff = log.before != null || log.after != null;
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Time", value: format(readableDate(log.createdAt), "yyyy-MM-dd HH:mm:ss") },
    { label: "User agent", value: log.userAgent },
    {
      label: "Target",
      value: log.targetKind && log.targetId && (
        <HStack gap={3} flexWrap="wrap">
          <Text as="span">
            {log.targetKind} {log.targetId}
          </Text>
          <Link
            color="blue.fg"
            fontFamily="body"
            href={`/settings/audit-log?targetKind=${encodeURIComponent(log.targetKind)}&targetId=${encodeURIComponent(log.targetId)}`}
          >
            All events for this target
          </Link>
        </HStack>
      ),
    },
    { label: "Operator", value: log.actorUserId },
    { label: "Entry id", value: log.id },
  ];

  return (
    <Box paddingY={2} data-testid="audit-log-detail">
      <Grid
        templateColumns="max-content 1fr"
        columnGap={6}
        rowGap={0.5}
        fontSize="xs"
        marginBottom={2}
      >
        {facts
          .filter(({ value }) => value != null && value !== "")
          .map(({ label, value }) => (
            <Box key={label} display="contents">
              <Text color="fg.muted">{label}</Text>
              <Box fontFamily="mono" wordBreak="break-all">
                {value}
              </Box>
            </Box>
          ))}
      </Grid>
      {hasDiff ? (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={2}>
          <JsonBlock title="Before" value={log.before} />
          <JsonBlock title="After" value={log.after} />
        </SimpleGrid>
      ) : (
        <JsonBlock title="Arguments" value={log.args} />
      )}
    </Box>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <Text fontSize="xs" color="fg.muted" paddingX={2} paddingY={1} bg="bg.subtle">
        {title}
      </Text>
      <Box as="pre" fontFamily="mono" fontSize="xs" padding={2} maxHeight="240px" overflow="auto">
        {json(value)}
      </Box>
    </Box>
  );
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
