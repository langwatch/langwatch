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
 * The pure half of `migrateSlackConnections` (ADR-093 §5a): which connections to
 * create or reuse, which automation points at which, whose own secret is
 * cleared. No scope is ever widened.
 */

/** A stored Slack `actionParams`, read leniently: a legacy row may lack any field. */
const storedSlackParamsSchema = z.object({
  slackDelivery: slackDeliveryMethodSchema.nullish(),
  slackWebhook: z.string().nullish(),
  slackBotToken: z.string().nullish(),
  slackIntegrationId: z.string().nullish(),
});

/** The fields that hold an automation's own Slack secret, or say it has one. */
export const LEGACY_SLACK_SECRET_FIELDS = [
  "slackWebhook",
  "slackBotToken",
  "slackBotTokenSet",
] as const;

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

/** An existing connection the plan links to: the project's own, else its organization's. */
export interface ReusedConnection extends ConnectionTarget {
  action: "reuse";
  connectionId: string;
}

export type PlannedConnection = CreatedConnection | ReusedConnection;

export interface OrganizationMigrationPlan {
  organizationId: string;
  connections: PlannedConnection[];
  /** Already on a connection, still storing a secret of their own to clear. */
  cleared: MigrationAutomation[];
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
  projectId: string;
  fingerprint: string;
  kind: SlackIntegrationKind;
  secret?: string;
  /** The connections holding the secret that the project can already use. */
  holders: MigrationConnection[];
  members: MigrationAutomation[];
}

function isLinkedToConnection({
  actionParams,
}: {
  actionParams: unknown;
}): boolean {
  const parsed = storedSlackParamsSchema.safeParse(actionParams);
  return parsed.success && !!parsed.data.slackIntegrationId?.trim();
}

function carriesLegacySecret({
  actionParams,
}: {
  actionParams: unknown;
}): boolean {
  if (typeof actionParams !== "object" || actionParams === null) return false;
  return LEGACY_SLACK_SECRET_FIELDS.some((field) => field in actionParams);
}

/** True unless the automation points at a connection and stores no secret of its own. */
export function needsSlackMigration({
  actionParams,
}: {
  actionParams: unknown;
}): boolean {
  return (
    !isLinkedToConnection({ actionParams }) ||
    carriesLegacySecret({ actionParams })
  );
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

/** The row a group reuses: its project's own, else its organization's (the save path's rule). */
function reusedHolder({
  group,
}: {
  group: Group;
}): MigrationConnection | undefined {
  return (
    group.holders.find(
      (holder) => holder.scopeType === SlackIntegrationScopeType.PROJECT,
    ) ?? group.holders[0]
  );
}

function plannedConnectionFor({
  group,
}: {
  group: Group;
}): PlannedConnection | undefined {
  const existing = reusedHolder({ group });
  if (existing) {
    return {
      action: "reuse",
      connectionId: existing.id,
      name: existing.name,
      kind: existing.kind,
      scopeType: existing.scopeType,
      scopeId: existing.scopeId,
      members: group.members,
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
    scopeType: SlackIntegrationScopeType.PROJECT,
    scopeId: group.projectId,
    members: group.members,
  };
}

/**
 * The group for one project's secret, opened on first sight with the
 * connections holding it that the project can already use. Another project's
 * copy is never among them, so it is never borrowed or widened.
 */
function groupFor({
  groups,
  connections,
  projectId,
  joined,
}: {
  groups: Map<string, Group>;
  connections: MigrationConnection[];
  projectId: string;
  joined: Joined;
}): Group {
  const key = `${projectId}\u0000${joined.fingerprint}`;
  const found = groups.get(key);
  if (found) return found;
  const holders = connections.filter(
    (connection) =>
      connection.secretFingerprint === joined.fingerprint &&
      (connection.scopeType === SlackIntegrationScopeType.ORGANIZATION ||
        connection.scopeId === projectId),
  );
  const group: Group = {
    projectId,
    fingerprint: joined.fingerprint,
    kind: holders[0]?.kind ?? joined.kind,
    holders,
    members: [],
  };
  groups.set(key, group);
  return group;
}

/**
 * Groups one organization's automations by project and secret, reusing a
 * connection the project can already use that holds it. A tokenless bot joins
 * its project's bot connection; archived or unusable rows are skipped.
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
  const groups = new Map<string, Group>();
  const cleared: MigrationAutomation[] = [];
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
    if (classified.outcome === "linked") {
      if (carriesLegacySecret(automation)) cleared.push(automation);
      continue;
    }
    if (classified.outcome === "skip") {
      skipped.push({ automation, reason: classified.reason });
      continue;
    }
    const group = groupFor({
      groups,
      connections,
      projectId: automation.projectId,
      joined: classified,
    });
    if (group.kind !== classified.kind) {
      skipped.push({ automation, reason: "kind conflict" });
      continue;
    }
    group.secret ??= classified.secret;
    group.members.push(automation);
  }

  const planned = [...groups.values()]
    .filter((group) => group.members.length > 0)
    .map((group) => plannedConnectionFor({ group }))
    .filter((connection) => connection !== undefined);

  return { organizationId, connections: planned, cleared, skipped };
}
