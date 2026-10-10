/**
 * One-off (ADR-093 §5a): points every Slack automation at a connection holding
 * its secret and clears the secret it stored. `pnpm run task
 * migrateSlackConnections` is a dry run; `--apply` writes, per organization.
 */

import {
  OrganizationUserRole,
  Prisma,
  SlackIntegrationKind,
  TriggerAction,
} from "~/generated/prisma/client";
import {
  LEGACY_SLACK_SECRET_FIELDS,
  type MigrationAutomation,
  needsSlackMigration,
  type OrganizationMigrationPlan,
  type PlannedConnection,
  planSlackConnectionMigration,
  type SkippedAutomation,
} from "../server/app-layer/automations/slack-integration/migration/slack-connection-migration.plan";
import {
  dryRunOutcome,
  formatOrganizationOutcome,
  formatTally,
  type OrganizationMigrationOutcome,
  tallyOutcomes,
} from "../server/app-layer/automations/slack-integration/migration/slack-connection-migration.report";
import { slackSecretFingerprint } from "../server/app-layer/automations/slack-integration/slack-secret-fingerprint";
import { prisma } from "../server/db";
import { decrypt, encrypt } from "../utils/encryption";

/** Stands in for a creator when the organization has no admin to name. */
const MIGRATION_ACTOR_ID = "system:migration";
const ID_CHUNK = 500;
const MAX_ATTEMPTS = 2;

/** Every project id keyed to its organization; a project whose team row is gone belongs to none. */
async function loadProjectOrganizations(): Promise<Map<string, string>> {
  const projects = await prisma.project.findMany({
    select: { id: true, teamId: true },
  });
  const teamIds = [...new Set(projects.map((project) => project.teamId))];
  const teamOrganizations = new Map<string, string>();
  for (let start = 0; start < teamIds.length; start += ID_CHUNK) {
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds.slice(start, start + ID_CHUNK) } },
      select: { id: true, organizationId: true },
    });
    for (const team of teams) {
      teamOrganizations.set(team.id, team.organizationId);
    }
  }
  const projectOrganizations = new Map<string, string>();
  for (const project of projects) {
    const organizationId = teamOrganizations.get(project.teamId);
    if (organizationId) projectOrganizations.set(project.id, organizationId);
  }
  return projectOrganizations;
}

function loadSlackAutomations({
  projectIds,
}: {
  projectIds: string[];
}): Promise<MigrationAutomation[]> {
  return prisma.trigger.findMany({
    where: {
      projectId: { in: projectIds },
      action: TriggerAction.SEND_SLACK_MESSAGE,
      deleted: false,
    },
    select: { id: true, projectId: true, name: true, actionParams: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** The organizations holding a Slack automation still to move or clear, within `scope` when given. */
async function findOrganizationsToMigrate({
  projectOrganizations,
  scope,
}: {
  projectOrganizations: Map<string, string>;
  scope?: string[];
}): Promise<string[]> {
  const projectIds = [...projectOrganizations.keys()];
  const organizationIds = new Set<string>();
  for (let start = 0; start < projectIds.length; start += ID_CHUNK) {
    const automations = await loadSlackAutomations({
      projectIds: projectIds.slice(start, start + ID_CHUNK),
    });
    for (const automation of automations) {
      if (!needsSlackMigration(automation)) continue;
      const organizationId = projectOrganizations.get(automation.projectId);
      if (organizationId) organizationIds.add(organizationId);
    }
  }
  const found = [...organizationIds].sort();
  return scope ? found.filter((id) => scope.includes(id)) : found;
}

async function planOrganization({
  organizationId,
  projectIds,
}: {
  organizationId: string;
  projectIds: string[];
}): Promise<OrganizationMigrationPlan> {
  const [automations, archivedProjects, connections] = await Promise.all([
    loadSlackAutomations({ projectIds }),
    prisma.project.findMany({
      where: { id: { in: projectIds }, archivedAt: { not: null } },
      select: { id: true },
    }),
    prisma.slackIntegration.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        kind: true,
        scopeType: true,
        scopeId: true,
        secretFingerprint: true,
      },
    }),
  ]);
  return planSlackConnectionMigration({
    organizationId,
    automations,
    archivedProjectIds: archivedProjects.map((project) => project.id),
    connections,
    decryptSecret: ({ ciphertext }) => decrypt(ciphertext),
    fingerprintSecret: slackSecretFingerprint,
  });
}

type Transaction = Prisma.TransactionClient;

/** The organization's first admin, else a fixed system actor. */
async function findActorId({
  tx,
  organizationId,
}: {
  tx: Transaction;
  organizationId: string;
}): Promise<string> {
  const admin = await tx.organizationUser.findFirst({
    where: { organizationId, role: OrganizationUserRole.ADMIN },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? MIGRATION_ACTOR_ID;
}

/** Creates the connection, or returns the reused one's id as it is. */
async function storeConnection({
  tx,
  connection,
  organizationId,
  actorId,
}: {
  tx: Transaction;
  connection: PlannedConnection;
  organizationId: string;
  actorId: string;
}): Promise<string> {
  if (connection.action === "reuse") return connection.connectionId;
  const isBot = connection.kind === SlackIntegrationKind.BOT;
  const ciphertext = encrypt(connection.secret);
  const created = await tx.slackIntegration.create({
    data: {
      name: connection.name,
      kind: connection.kind,
      scopeType: connection.scopeType,
      scopeId: connection.scopeId,
      organizationId,
      botTokenEncrypted: isBot ? ciphertext : null,
      webhookUrlEncrypted: isBot ? null : ciphertext,
      secretFingerprint: connection.secretFingerprint,
      secretHint: connection.secretHint,
      createdById: actorId,
      updatedById: actorId,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Sets `slackIntegrationId` and drops the legacy secret fields. Lands only while
 * the settings are exactly what the plan read and carry no connection yet;
 * false means the automation changed underneath the run.
 */
async function linkAutomation({
  tx,
  automation,
  connectionId,
}: {
  tx: Transaction;
  automation: MigrationAutomation;
  connectionId: string;
}): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Trigger"
    SET "actionParams" = ("actionParams" - ${LEGACY_SLACK_SECRET_FIELDS}::text[])
          || jsonb_build_object('slackIntegrationId', ${connectionId}::text),
        "updatedAt" = NOW()
    WHERE "id" = ${automation.id}
      AND "projectId" = ${automation.projectId}
      AND "actionParams" = ${JSON.stringify(automation.actionParams)}::jsonb
      AND ("actionParams" -> 'slackIntegrationId') IS NULL`;
  return updated === 1;
}

/** Drops the legacy secret fields of an automation already on a connection, on the same terms. */
async function clearLegacySecret({
  tx,
  automation,
}: {
  tx: Transaction;
  automation: MigrationAutomation;
}): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Trigger"
    SET "actionParams" = "actionParams" - ${LEGACY_SLACK_SECRET_FIELDS}::text[],
        "updatedAt" = NOW()
    WHERE "id" = ${automation.id}
      AND "projectId" = ${automation.projectId}
      AND "actionParams" = ${JSON.stringify(automation.actionParams)}::jsonb`;
  return updated === 1;
}

/** Stores or reuses each planned connection and links its members; the rest are reported changed. */
async function linkPlannedMembers({
  tx,
  plan,
  actorId,
}: {
  tx: Transaction;
  plan: OrganizationMigrationPlan;
  actorId: string;
}): Promise<{ linkedIds: string[]; changed: SkippedAutomation[] }> {
  const linkedIds: string[] = [];
  const changed: SkippedAutomation[] = [];
  for (const connection of plan.connections) {
    const connectionId = await storeConnection({
      tx,
      connection,
      organizationId: plan.organizationId,
      actorId,
    });
    for (const automation of connection.members) {
      if (await linkAutomation({ tx, automation, connectionId })) {
        linkedIds.push(automation.id);
      } else {
        changed.push({ automation, reason: "changed during migration" });
      }
    }
  }
  return { linkedIds, changed };
}

/** Clears each already-linked automation's own secret; the rest are reported changed. */
async function clearPlannedSecrets({
  tx,
  plan,
}: {
  tx: Transaction;
  plan: OrganizationMigrationPlan;
}): Promise<{ clearedIds: string[]; changed: SkippedAutomation[] }> {
  const clearedIds: string[] = [];
  const changed: SkippedAutomation[] = [];
  for (const automation of plan.cleared) {
    if (await clearLegacySecret({ tx, automation })) {
      clearedIds.push(automation.id);
    } else {
      changed.push({ automation, reason: "changed during migration" });
    }
  }
  return { clearedIds, changed };
}

/** Writes one organization's plan in one transaction. */
function applyPlan({
  plan,
}: {
  plan: OrganizationMigrationPlan;
}): Promise<OrganizationMigrationOutcome> {
  return prisma.$transaction(
    async (tx) => {
      const actorId = await findActorId({
        tx,
        organizationId: plan.organizationId,
      });
      const linked = await linkPlannedMembers({ tx, plan, actorId });
      const cleared = await clearPlannedSecrets({ tx, plan });
      return {
        plan,
        linkedIds: linked.linkedIds,
        clearedIds: cleared.clearedIds,
        skipped: [...plan.skipped, ...linked.changed, ...cleared.changed],
      };
    },
    { timeout: 120_000 },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Plans and, when applying, writes one organization. A unique violation means
 * a concurrent run stored the same secret first: the transaction rolled back,
 * so re-read and re-plan, which reuses that row instead.
 */
export async function migrateOrganization({
  organizationId,
  projectIds,
  apply,
}: {
  organizationId: string;
  projectIds: string[];
  apply: boolean;
}): Promise<OrganizationMigrationOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    const plan = await planOrganization({ organizationId, projectIds });
    if (!apply) return dryRunOutcome({ plan });
    try {
      return await applyPlan({ plan });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isUniqueViolation(error)) throw error;
    }
  }
}

/** Names the failure without its message, which may echo query arguments. */
function errorLabel(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return error instanceof Error ? error.name : "unknown error";
}

function projectIdsByOrganization({
  projectOrganizations,
}: {
  projectOrganizations: Map<string, string>;
}): Map<string, string[]> {
  const byOrganization = new Map<string, string[]>();
  for (const [projectId, organizationId] of projectOrganizations) {
    const projectIds = byOrganization.get(organizationId) ?? [];
    projectIds.push(projectId);
    byOrganization.set(organizationId, projectIds);
  }
  return byOrganization;
}

/**
 * The task behind `pnpm run task migrateSlackConnections [--apply]`. The CLI
 * never passes `organizationIds`; tests do, so an apply stays inside their own
 * tenants in a database other suites share.
 */
export async function runSlackConnectionMigration({
  args,
  organizationIds: scope,
}: {
  args: string[];
  organizationIds?: string[];
}): Promise<void> {
  const unknownArgs = args.filter((arg) => arg !== "--apply");
  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown argument ${unknownArgs.join(" ")}; the only option is --apply`,
    );
  }
  const apply = args.includes("--apply");
  console.log(
    apply
      ? "Slack connection migration: applying."
      : "Slack connection migration: dry run, nothing is written. Re-run with --apply to write.",
  );

  const projectOrganizations = await loadProjectOrganizations();
  const organizationIds = await findOrganizationsToMigrate({
    projectOrganizations,
    scope,
  });
  const projectIds = projectIdsByOrganization({ projectOrganizations });
  const organizations = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
  });
  const names = new Map(organizations.map((org) => [org.id, org.name]));

  const outcomes: OrganizationMigrationOutcome[] = [];
  const failed: string[] = [];
  for (const organizationId of organizationIds) {
    const organizationName = names.get(organizationId) ?? organizationId;
    try {
      const outcome = await migrateOrganization({
        organizationId,
        projectIds: projectIds.get(organizationId) ?? [],
        apply,
      });
      outcomes.push(outcome);
      for (const line of formatOrganizationOutcome({
        outcome,
        organizationName,
      })) {
        console.log(line);
      }
    } catch (error) {
      failed.push(organizationId);
      console.log(
        `Organization "${organizationName}" (${organizationId}) failed, nothing written: ${errorLabel(error)}`,
      );
    }
  }

  console.log(formatTally({ tally: tallyOutcomes({ outcomes }) }));
  if (failed.length > 0) {
    throw new Error(
      `Slack connection migration failed for ${failed.length} organization(s): ${failed.join(", ")}`,
    );
  }
}

export default function migrateSlackConnections(
  ...args: string[]
): Promise<void> {
  return runSlackConnectionMigration({ args });
}
