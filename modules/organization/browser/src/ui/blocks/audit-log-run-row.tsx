/** One audit table row (a run of identical events) and, opened, everything each entry stores. */

import type { WireOf } from "@langwatch/api/web";
import { UserAvatar } from "@langwatch/design-system/avatar";
import { CodePreview } from "@langwatch/design-system/code-preview";
import {
  Badge,
  Box,
  Grid,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";
import { format, formatDistanceToNow, readableDate } from "@langwatch/time";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Globe,
  Network,
  ServerCog,
  UserX,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { auditBackLink } from "../../model/audit-log-filters.ts";
import {
  auditActionPhrase,
  auditActor,
  type AuditActor,
  type AuditRun,
} from "../../model/audit-log-rows.ts";
import { Link } from "../elements/organization-link.tsx";

type EnrichedAuditLog = WireOf<StoredEnrichedAuditLog>;

const SHORT_TIME = "MMM d, HH:mm:ss";
const FULL_TIME = "yyyy-MM-dd HH:mm:ss";

export function AuditLogRunRow({
  run,
  columns,
  projectLabel,
  projectSlug,
  scopeProjectId,
}: {
  run: AuditRun<EnrichedAuditLog>;
  columns: { target: boolean; project: boolean };
  projectLabel: (projectId: string) => string;
  projectSlug: string | undefined;
  scopeProjectId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const log = run.entries[0];
  const count = run.entries.length;
  const Chevron = open ? ChevronDown : ChevronRight;
  const columnCount = 4 + Number(columns.target) + Number(columns.project);

  return (
    <>
      <Table.Row
        cursor="pointer"
        onClick={() => setOpen((isOpen) => !isOpen)}
        _hover={{ bg: "bg.subtle" }}
        data-testid="audit-log-row"
      >
        <Table.Cell width="8" paddingRight={0}>
          <Box
            as="button"
            aria-expanded={open}
            aria-label={`Details of ${auditActionPhrase(log.action)}`}
            color="fg.muted"
            display="flex"
            alignItems="center"
          >
            <Chevron size={14} />
          </Box>
        </Table.Cell>
        <Table.Cell whiteSpace="nowrap" width="1">
          <AuditTime at={log.createdAt} />
        </Table.Cell>
        <Table.Cell whiteSpace="nowrap">
          <ActorLabel actor={auditActor(log)} />
        </Table.Cell>
        <Table.Cell width="full">
          <HStack gap={2} minWidth={0}>
            <Text fontSize="sm" truncate>
              {auditActionPhrase(log.action)}
            </Text>
            {count > 1 && (
              <Badge
                size="xs"
                variant="subtle"
                colorPalette="gray"
                fontVariantNumeric="tabular-nums"
              >
                ×{count}
              </Badge>
            )}
            {log.error && (
              <Tooltip content={log.error}>
                <Badge size="xs" variant="subtle" colorPalette="red" gap={1}>
                  <CircleAlert size={10} />
                  Failed
                </Badge>
              </Tooltip>
            )}
            {log.source === "gateway" && (
              <Tooltip content="Recorded by the AI Gateway">
                <Box as="span" color="fg.muted" aria-label="AI Gateway" display="inline-flex">
                  <Network size={12} />
                </Box>
              </Tooltip>
            )}
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
              {log.action}
            </Text>
          </HStack>
        </Table.Cell>
        {columns.target && (
          <Table.Cell whiteSpace="nowrap">
            {log.targetKind && log.targetId && (
              <Tooltip content={`${log.targetKind} ${log.targetId}`}>
                <Text fontSize="xs" color="fg.muted">
                  {log.targetKind}{" "}
                  <Text as="span" fontFamily="mono" color="fg">
                    {log.targetId.slice(0, 12)}…
                  </Text>
                </Text>
              </Tooltip>
            )}
          </Table.Cell>
        )}
        {columns.project && (
          <Table.Cell whiteSpace="nowrap">
            {log.projectId && (
              <Text fontSize="sm" color="fg.muted">
                {projectLabel(log.projectId)}
              </Text>
            )}
          </Table.Cell>
        )}
      </Table.Row>
      {open && (
        <Table.Row bg="bg.subtle" _hover={{ bg: "bg.subtle" }}>
          <Table.Cell colSpan={columnCount} paddingX={4} paddingY={3}>
            <VStack align="stretch" gap={4}>
              {run.entries.map((entry) => (
                <AuditEntryDetail
                  key={entry.id}
                  log={entry}
                  showTime={count > 1}
                  projectLabel={projectLabel}
                  projectSlug={projectSlug}
                  scopeProjectId={scopeProjectId}
                />
              ))}
            </VStack>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

function AuditTime({ at }: { at: string }) {
  const date = readableDate(at);
  return (
    <Tooltip
      content={`${format(date, FULL_TIME)} · ${formatDistanceToNow(date, { addSuffix: true })}`}
    >
      <Text as="span" fontSize="sm" color="fg.muted" fontVariantNumeric="tabular-nums">
        {format(date, SHORT_TIME)}
      </Text>
    </Tooltip>
  );
}

const ACTOR_ICON = {
  system: { Icon: ServerCog, label: "System", kind: "Background job" },
  anonymous: { Icon: Globe, label: "Unidentified caller", kind: "No credential" },
  unresolved: { Icon: UserX, label: "User not found", kind: "Deleted or unknown user" },
} as const;

function ActorLabel({ actor }: { actor: AuditActor }) {
  if (actor.kind === "user") {
    return (
      <Tooltip content={actor.email ?? actor.id}>
        <HStack gap={2}>
          <UserAvatar size="2xs" boxSize="5" fontSize="2xs" name={actor.name} />
          <Text fontSize="sm" fontWeight="medium">
            {actor.name}
          </Text>
        </HStack>
      </Tooltip>
    );
  }
  const { Icon, label, kind } = ACTOR_ICON[actor.kind];
  return (
    <Tooltip content={actor.kind === "unresolved" ? `${kind}: ${actor.id}` : kind}>
      <HStack gap={2} color="fg.muted">
        <Box
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          boxSize="5"
          borderRadius="full"
          bg="bg.emphasized"
        >
          <Icon size={11} />
        </Box>
        <Text fontSize="sm">{label}</Text>
      </HStack>
    </Tooltip>
  );
}

function AuditEntryDetail({
  log,
  showTime,
  projectLabel,
  projectSlug,
  scopeProjectId,
}: {
  log: EnrichedAuditLog;
  showTime: boolean;
  projectLabel: (projectId: string) => string;
  projectSlug: string | undefined;
  scopeProjectId: string | undefined;
}) {
  const actor = auditActor(log);
  const target =
    log.targetKind && log.targetId
      ? { targetKind: log.targetKind, targetId: log.targetId }
      : void 0;
  // A resource link is only safe when the row lives in the project the reader is in.
  const resource = log.projectId === scopeProjectId ? auditBackLink({ target, projectSlug }) : null;
  const hasDiff = log.before != null || log.after != null;
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Time", value: format(readableDate(log.createdAt), FULL_TIME) },
    {
      label: "Actor",
      value:
        actor.kind === "user" ? `${actor.name} · ${actor.email ?? actor.id}` : actorText(actor),
    },
    { label: "Action", value: log.action },
    {
      label: "Target",
      value: target && (
        <HStack gap={3} flexWrap="wrap">
          <Text as="span">
            {target.targetKind} {target.targetId}
          </Text>
          {resource && (
            <Link href={resource.href} color="blue.fg" fontFamily="body">
              Open {resource.label.toLowerCase()}
            </Link>
          )}
          <Link
            color="blue.fg"
            fontFamily="body"
            href={`/settings/audit-log?targetKind=${encodeURIComponent(target.targetKind)}&targetId=${encodeURIComponent(target.targetId)}`}
          >
            All events for this target
          </Link>
        </HStack>
      ),
    },
    { label: "Project", value: log.projectId && projectLabel(log.projectId) },
    { label: "Organization", value: log.organizationId },
    { label: "IP address", value: log.ipAddress },
    { label: "User agent", value: log.userAgent },
    {
      label: "Error",
      value: log.error && (
        <Text as="span" color="fg.error">
          {log.error}
        </Text>
      ),
    },
    { label: "Entry id", value: log.id },
  ];

  return (
    <VStack align="stretch" gap={3} data-testid="audit-log-detail">
      {showTime && (
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          {format(readableDate(log.createdAt), FULL_TIME)}
        </Text>
      )}
      <Grid templateColumns="max-content 1fr" columnGap={6} rowGap={1} fontSize="xs">
        {facts
          .filter(({ value }) => value != null && value !== "")
          .map(({ label, value }) => (
            <Fragment key={label}>
              <Text color="fg.muted">{label}</Text>
              <Box fontFamily="mono" wordBreak="break-all">
                {value}
              </Box>
            </Fragment>
          ))}
      </Grid>
      {hasDiff ? (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
          <CodePreview
            code={json(log.before)}
            language="json"
            filename="Before"
            maxHeight="240px"
          />
          <CodePreview code={json(log.after)} language="json" filename="After" maxHeight="240px" />
        </SimpleGrid>
      ) : (
        log.args != null && (
          <CodePreview
            code={json(log.args)}
            language="json"
            filename="Arguments"
            maxHeight="240px"
          />
        )
      )}
      <CodePreview code={json(log)} language="json" filename="Raw entry" maxHeight="160px" />
    </VStack>
  );
}

function actorText(actor: Exclude<AuditActor, { kind: "user" }>): string {
  const { label, kind } = ACTOR_ICON[actor.kind];
  return actor.kind === "unresolved" ? `${label} · ${actor.id}` : `${label} · ${kind}`;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
