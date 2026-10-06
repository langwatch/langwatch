import { slackDeliveryMethodSchema } from "@langwatch/automation-contract";
import {
  defaultSlackConnectionName,
  slackSecretHint,
  type SlackConnectionKind,
} from "@langwatch/slack-contract";
import { z } from "zod";

/**
 * The pure half of the Slack connection migration (ARCHITECTURE.md §7): which
 * secret each automation moves onto a connection, which automation joins
 * which, whose own secret is cleared. Reuse is slack's (`findOrCreate`).
 */

/** A stored Slack `actionParams`, read leniently: a legacy row may lack any field. */
const storedSlackParamsSchema = z.object({
  slackDelivery: slackDeliveryMethodSchema.nullish(),
  slackWebhook: z.string().nullish(),
  slackBotToken: z.string().nullish(),
  slackIntegrationId: z.string().nullish(),
});

/** The fields that hold an automation's own Slack secret, or say it has one. */
const LEGACY_SLACK_SECRET_FIELDS = ["slackWebhook", "slackBotToken", "slackBotTokenSet"] as const;

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

/** One of a project's own bot connections, which a tokenless bot automation joins. */
export interface ProjectBotConnection {
  id: string;
  name: string;
  projectId: string;
}

export interface SkippedAutomation {
  automation: MigrationAutomation;
  reason: SlackMigrationSkipReason;
}

/** A secret stored as a connection (found or created by slack); `secret` is never reported. */
interface StoredConnection {
  action: "store";
  kind: SlackConnectionKind;
  projectId: string;
  secret: string;
  secretHint: string;
  name: string;
  members: MigrationAutomation[];
}

/** An existing project bot connection that tokenless bot automations join. */
interface JoinedConnection {
  action: "join";
  connectionId: string;
  name: string;
  projectId: string;
  members: MigrationAutomation[];
}

export type PlannedConnection = StoredConnection | JoinedConnection;

export interface OrganizationMigrationPlan {
  organizationId: string;
  connections: PlannedConnection[];
  /** Already on a connection, still storing a secret of their own to clear. */
  cleared: MigrationAutomation[];
  skipped: SkippedAutomation[];
}

type SecretReader = (params: { ciphertext: string }) => string;

type Classified =
  | { outcome: "linked" }
  | { outcome: "skip"; reason: SlackMigrationSkipReason }
  | { outcome: "store"; kind: SlackConnectionKind; secret: string }
  | { outcome: "join"; connection: ProjectBotConnection };

function carriesLegacySecret({ actionParams }: { actionParams: unknown }): boolean {
  if (typeof actionParams !== "object" || actionParams === null) return false;
  return LEGACY_SLACK_SECRET_FIELDS.some((field) => field in actionParams);
}

/** A tokenless bot posted through its project's bot connection, so it joins that one. */
function joinProjectConnection({
  automation,
  projectBots,
}: {
  automation: MigrationAutomation;
  projectBots: ProjectBotConnection[];
}): Classified {
  const own = projectBots.filter((connection) => connection.projectId === automation.projectId);
  const [only] = own;
  if (!only) return { outcome: "skip", reason: "no secret" };
  if (own.length > 1) return { outcome: "skip", reason: "ambiguous project connection" };
  return { outcome: "join", connection: only };
}

function classify({
  automation,
  isArchived,
  projectBots,
  decryptSecret,
}: {
  automation: MigrationAutomation;
  isArchived: boolean;
  projectBots: ProjectBotConnection[];
  decryptSecret: SecretReader;
}): Classified {
  const parsed = storedSlackParamsSchema.safeParse(automation.actionParams);
  if (!parsed.success) return { outcome: "skip", reason: "unreadable settings" };
  const params = parsed.data;
  if (params.slackIntegrationId?.trim()) return { outcome: "linked" };
  if (isArchived) return { outcome: "skip", reason: "archived project" };

  if ((params.slackDelivery ?? "webhook") === "webhook") {
    const secret = params.slackWebhook?.trim();
    if (!secret) return { outcome: "skip", reason: "no secret" };
    return { outcome: "store", kind: "INCOMING_WEBHOOK", secret };
  }

  if (!params.slackBotToken) return joinProjectConnection({ automation, projectBots });
  let secret: string;
  try {
    secret = decryptSecret({ ciphertext: params.slackBotToken }).trim();
  } catch {
    return { outcome: "skip", reason: "cannot decrypt" };
  }
  if (!secret) return joinProjectConnection({ automation, projectBots });
  return { outcome: "store", kind: "BOT", secret };
}

/**
 * Groups one organization's automations by project and secret; a tokenless bot
 * joins its project's bot connection; archived or unusable rows are skipped.
 * No scope is ever widened: every stored connection is the project's own.
 */
export function planSlackConnectionMigration({
  organizationId,
  automations,
  archivedProjectIds,
  projectBots,
  decryptSecret,
}: {
  organizationId: string;
  automations: MigrationAutomation[];
  archivedProjectIds: string[];
  projectBots: ProjectBotConnection[];
  decryptSecret: SecretReader;
}): OrganizationMigrationPlan {
  const stored = new Map<string, StoredConnection>();
  const joined = new Map<string, JoinedConnection>();
  const cleared: MigrationAutomation[] = [];
  const skipped: SkippedAutomation[] = [];
  const archived = new Set(archivedProjectIds);

  for (const automation of automations) {
    const classified = classify({
      automation,
      isArchived: archived.has(automation.projectId),
      projectBots,
      decryptSecret,
    });
    if (classified.outcome === "linked") {
      if (carriesLegacySecret(automation)) cleared.push(automation);
    } else if (classified.outcome === "skip") {
      skipped.push({ automation, reason: classified.reason });
    } else if (classified.outcome === "join") {
      const { connection } = classified;
      const group: JoinedConnection = joined.get(connection.id) ?? {
        action: "join",
        connectionId: connection.id,
        name: connection.name,
        projectId: connection.projectId,
        members: [],
      };
      group.members.push(automation);
      joined.set(connection.id, group);
    } else {
      const key = `${automation.projectId}\u0000${classified.secret}`;
      const group: StoredConnection = stored.get(key) ?? {
        action: "store",
        kind: classified.kind,
        projectId: automation.projectId,
        secret: classified.secret,
        secretHint: slackSecretHint({ secret: classified.secret }),
        name: defaultSlackConnectionName({ kind: classified.kind, secret: classified.secret }),
        members: [],
      };
      if (group.kind !== classified.kind) {
        skipped.push({ automation, reason: "kind conflict" });
        continue;
      }
      group.members.push(automation);
      stored.set(key, group);
    }
  }

  return {
    organizationId,
    connections: [...stored.values(), ...joined.values()],
    cleared,
    skipped,
  };
}

/** The params after a move: pointed at the connection, every legacy secret field dropped. */
export function withoutLegacySlackSecret({
  actionParams,
  connectionId,
}: {
  actionParams: unknown;
  connectionId?: string;
}): Record<string, unknown> {
  const params = typeof actionParams === "object" && actionParams !== null ? actionParams : {};
  const kept = Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => !LEGACY_SLACK_SECRET_FIELDS.some((field) => field === key),
    ),
  );
  return connectionId ? { ...kept, slackIntegrationId: connectionId } : kept;
}
