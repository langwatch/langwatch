import { slackDeliveryMethodSchema } from "@langwatch/automations/providers/slack";
import { z } from "zod";
import {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import {
  defaultSlackConnectionName,
  slackSecretHint,
} from "../slack-secret-fingerprint";

/**
 * The pure half of `migrateSlackConnections` (ADR-093 §5a): from one
 * organization's Slack automations and connections, decide which connections
 * to create, reuse or widen and which automation points at which.
 */

/** A stored Slack `actionParams`, read leniently: a legacy row may lack any field. */
const storedSlackParamsSchema = z.object({
  slackDelivery: slackDeliveryMethodSchema.nullish(),
  slackWebhook: z.string().nullish(),
  slackBotToken: z.string().nullish(),
  slackIntegrationId: z.string().nullish(),
});

export type SlackMigrationSkipReason =
  | "archived project"
  | "no secret"
  | "cannot decrypt"
  | "unreadable settings"
  | "ambiguous project connection"
  | "kind conflict"
  | "changed during migration";

export interface MigrationAutomation {
  id: string;
  projectId: string;
  name: string;
  actionParams: unknown;
}

export interface MigrationConnection {
  id: string;
  name: string;
  kind: SlackIntegrationKind;
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
  secretFingerprint: string;
}

export interface SkippedAutomation {
  automation: MigrationAutomation;
  reason: SlackMigrationSkipReason;
}

interface ConnectionTarget {
  name: string;
  kind: SlackIntegrationKind;
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
  members: MigrationAutomation[];
}

/** A connection the plan creates; `secret` is plaintext and is never printed. */
export interface CreatedConnection extends ConnectionTarget {
  action: "create";
  secret: string;
  secretFingerprint: string;
  secretHint: string;
}

/** An existing connection the plan links to, widened when it must reach more projects. */
export interface ReusedConnection extends ConnectionTarget {
  action: "reuse";
  connectionId: string;
  widenedFromProjectId?: string;
}

export type PlannedConnection = CreatedConnection | ReusedConnection;

export interface OrganizationMigrationPlan {
  organizationId: string;
  connections: PlannedConnection[];
  skipped: SkippedAutomation[];
}

type SecretReader = (params: { ciphertext: string }) => string;
type Fingerprinter = (params: { secret: string }) => string;

/** Where an automation's secret lives: its own (`secret` set) or a connection it joins. */
interface Joined {
  outcome: "join";
  kind: SlackIntegrationKind;
  fingerprint: string;
  secret?: string;
}

type Classified =
  | { outcome: "linked" }
  | { outcome: "skip"; reason: SlackMigrationSkipReason }
  | Joined;

interface Group {
  fingerprint: string;
  kind: SlackIntegrationKind;
  secret?: string;
  existing?: MigrationConnection;
  members: MigrationAutomation[];
}

/** True when the automation already points at a connection: the migration leaves it alone. */
export function isLinkedToConnection({
  actionParams,
}: {
  actionParams: unknown;
}): boolean {
  const parsed = storedSlackParamsSchema.safeParse(actionParams);
  return parsed.success && !!parsed.data.slackIntegrationId?.trim();
}

/** A tokenless bot posted through its project's §5 row, so it joins that row. */
function joinProjectConnection({
  automation,
  connections,
}: {
  automation: MigrationAutomation;
  connections: MigrationConnection[];
}): Classified {
  const projectRows = connections.filter(
    (connection) =>
      connection.scopeType === SlackIntegrationScopeType.PROJECT &&
      connection.scopeId === automation.projectId &&
      connection.kind === SlackIntegrationKind.BOT,
  );
  const [only] = projectRows;
  if (!only) return { outcome: "skip", reason: "no secret" };
  if (projectRows.length > 1) {
    return { outcome: "skip", reason: "ambiguous project connection" };
  }
  return {
    outcome: "join",
    kind: only.kind,
    fingerprint: only.secretFingerprint,
  };
}

function classify({
  automation,
  isArchived,
  connections,
  decryptSecret,
  fingerprintSecret,
}: {
  automation: MigrationAutomation;
  isArchived: boolean;
  connections: MigrationConnection[];
  decryptSecret: SecretReader;
  fingerprintSecret: Fingerprinter;
}): Classified {
  const parsed = storedSlackParamsSchema.safeParse(automation.actionParams);
  if (!parsed.success) {
    return { outcome: "skip", reason: "unreadable settings" };
  }
  const params = parsed.data;
  if (params.slackIntegrationId?.trim()) return { outcome: "linked" };
  if (isArchived) return { outcome: "skip", reason: "archived project" };

  if ((params.slackDelivery ?? "webhook") === "webhook") {
    const secret = params.slackWebhook?.trim();
    if (!secret) return { outcome: "skip", reason: "no secret" };
    const kind = SlackIntegrationKind.INCOMING_WEBHOOK;
    const fingerprint = fingerprintSecret({ secret });
    return { outcome: "join", kind, secret, fingerprint };
  }

  if (!params.slackBotToken) {
    return joinProjectConnection({ automation, connections });
  }
  let secret: string;
  try {
    secret = decryptSecret({ ciphertext: params.slackBotToken }).trim();
  } catch {
    return { outcome: "skip", reason: "cannot decrypt" };
  }
  if (!secret) return joinProjectConnection({ automation, connections });
  const kind = SlackIntegrationKind.BOT;
  const fingerprint = fingerprintSecret({ secret });
  return { outcome: "join", kind, secret, fingerprint };
}

/** One project when every member (and the reused row) sits in it, else the organization. */
function scopeFor({
  group,
  organizationId,
}: {
  group: Group;
  organizationId: string;
}): Pick<ConnectionTarget, "scopeType" | "scopeId"> {
  if (group.existing?.scopeType === SlackIntegrationScopeType.ORGANIZATION) {
    return { scopeType: group.existing.scopeType, scopeId: organizationId };
  }
  const projects = new Set(group.members.map((member) => member.projectId));
  if (group.existing) projects.add(group.existing.scopeId);
  const [only] = projects;
  if (projects.size === 1 && only) {
    return { scopeType: SlackIntegrationScopeType.PROJECT, scopeId: only };
  }
  return {
    scopeType: SlackIntegrationScopeType.ORGANIZATION,
    scopeId: organizationId,
  };
}

function plannedConnectionFor({
  group,
  organizationId,
}: {
  group: Group;
  organizationId: string;
}): PlannedConnection | undefined {
  const scope = scopeFor({ group, organizationId });
  if (group.existing) {
    const widened =
      group.existing.scopeType === SlackIntegrationScopeType.PROJECT &&
      scope.scopeType === SlackIntegrationScopeType.ORGANIZATION;
    return {
      action: "reuse",
      connectionId: group.existing.id,
      name: group.existing.name,
      kind: group.existing.kind,
      ...scope,
      members: group.members,
      ...(widened ? { widenedFromProjectId: group.existing.scopeId } : {}),
    };
  }
  if (group.secret === undefined) return undefined;
  const secretHint = slackSecretHint({ secret: group.secret });
  return {
    action: "create",
    secret: group.secret,
    secretFingerprint: group.fingerprint,
    secretHint,
    name: defaultSlackConnectionName({
      kind: group.kind,
      secret: group.secret,
    }),
    kind: group.kind,
    ...scope,
    members: group.members,
  };
}

/** The group for a fingerprint, opened on first sight with any connection already holding it. */
function groupFor({
  groups,
  byFingerprint,
  joined,
}: {
  groups: Map<string, Group>;
  byFingerprint: Map<string, MigrationConnection>;
  joined: Joined;
}): Group {
  const found = groups.get(joined.fingerprint);
  if (found) return found;
  const existing = byFingerprint.get(joined.fingerprint);
  const group: Group = {
    fingerprint: joined.fingerprint,
    kind: existing?.kind ?? joined.kind,
    existing,
    members: [],
  };
  groups.set(joined.fingerprint, group);
  return group;
}

/**
 * Groups one organization's automations by their secret's fingerprint, reusing
 * (never duplicating) a connection that already holds it. A tokenless bot joins
 * its project's bot connection; archived projects and anything unusable are skipped.
 */
export function planSlackConnectionMigration({
  organizationId,
  automations,
  archivedProjectIds,
  connections,
  decryptSecret,
  fingerprintSecret,
}: {
  organizationId: string;
  automations: MigrationAutomation[];
  /** Automations here are skipped, so an archived project never widens a scope. */
  archivedProjectIds: string[];
  connections: MigrationConnection[];
  decryptSecret: SecretReader;
  fingerprintSecret: Fingerprinter;
}): OrganizationMigrationPlan {
  const byFingerprint = new Map(
    connections.map((connection) => [connection.secretFingerprint, connection]),
  );
  const groups = new Map<string, Group>();
  const skipped: SkippedAutomation[] = [];
  const archived = new Set(archivedProjectIds);

  for (const automation of automations) {
    const classified = classify({
      automation,
      isArchived: archived.has(automation.projectId),
      connections,
      decryptSecret,
      fingerprintSecret,
    });
    if (classified.outcome === "linked") continue;
    if (classified.outcome === "skip") {
      skipped.push({ automation, reason: classified.reason });
      continue;
    }
    const group = groupFor({ groups, byFingerprint, joined: classified });
    if (group.kind !== classified.kind) {
      skipped.push({ automation, reason: "kind conflict" });
      continue;
    }
    group.secret ??= classified.secret;
    group.members.push(automation);
  }

  const planned = [...groups.values()]
    .filter((group) => group.members.length > 0)
    .map((group) => plannedConnectionFor({ group, organizationId }))
    .filter((connection) => connection !== undefined);

  return { organizationId, connections: planned, skipped };
}
