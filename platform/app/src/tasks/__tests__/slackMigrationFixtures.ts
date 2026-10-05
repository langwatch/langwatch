/**
 * Real rows for the Slack connection migration's integration tests: a tenant
 * (organization, team, projects), Slack automations as the legacy provider
 * stored them (bot token encrypted, webhook URL plaintext) and connections.
 */

import { nanoid } from "nanoid";
import {
  type Organization,
  OrganizationUserRole,
  type Prisma,
  type Project,
  type SlackIntegration,
  SlackIntegrationKind,
  type SlackIntegrationScopeType,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import {
  slackSecretFingerprint,
  slackSecretHint,
} from "~/server/app-layer/automations/slack-integration/slack-secret-fingerprint";
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";

export interface SlackMigrationTenant {
  organization: Organization;
  team: Team;
  projects: Project[];
}

export interface StoredAutomation {
  id: string;
  projectId: string;
  actionParams: Prisma.InputJsonObject;
}

export async function createSlackMigrationTenant({
  organizationId,
  label,
  projectCount,
}: {
  organizationId: string;
  label: string;
  projectCount: number;
}): Promise<SlackMigrationTenant> {
  const organization = await prisma.organization.create({
    data: {
      id: organizationId,
      name: `Slack Migration ${label}`,
      slug: `--test-org-${organizationId}`,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: `Slack Migration Team ${label}`,
      slug: `--test-team-${organizationId}`,
      organizationId,
    },
  });
  const projects: Project[] = [];
  for (let index = 0; index < projectCount; index += 1) {
    projects.push(
      await prisma.project.create({
        data: {
          name: `Slack Migration Project ${label} ${index}`,
          slug: `--test-project-${organizationId}-${index}`,
          teamId: team.id,
          language: "other",
          framework: "other",
          apiKey: `test-api-key-${organizationId}-${index}`,
        },
      }),
    );
  }
  return { organization, team, projects };
}

/** Deletes the tenant's automations, connections and memberships, keeping the tenant. */
export async function clearSlackMigrationTenant({
  tenant,
}: {
  tenant: SlackMigrationTenant;
}): Promise<void> {
  const organizationId = tenant.organization.id;
  await prisma.trigger.deleteMany({
    where: { projectId: { in: tenant.projects.map((project) => project.id) } },
  });
  await prisma.slackIntegration.deleteMany({ where: { organizationId } });
  const members = await prisma.organizationUser.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  await prisma.organizationUser.deleteMany({ where: { organizationId } });
  for (const { userId } of members) {
    await prisma.user.delete({ where: { id: userId } });
  }
}

export async function removeSlackMigrationTenant({
  tenant,
}: {
  tenant: SlackMigrationTenant;
}): Promise<void> {
  await clearSlackMigrationTenant({ tenant });
  for (const project of tenant.projects) {
    await prisma.project.delete({ where: { id: project.id } });
  }
  await prisma.team.delete({ where: { id: tenant.team.id } });
  await prisma.organization.delete({ where: { id: tenant.organization.id } });
}

/** Adds an organization admin and returns their user id, the actor the migration names. */
export async function addOrganizationAdmin({
  tenant,
}: {
  tenant: SlackMigrationTenant;
}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `admin-${tenant.organization.id}@example.com`,
      name: "Slack Migration Admin",
    },
  });
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId: tenant.organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  return user.id;
}

export async function storeSlackAutomation({
  projectId,
  actionParams,
  deleted = false,
  createdAt,
}: {
  projectId: string;
  actionParams: Prisma.InputJsonObject;
  deleted?: boolean;
  createdAt?: Date;
}): Promise<StoredAutomation> {
  const row = await prisma.trigger.create({
    data: {
      id: nanoid(),
      name: `Slack automation ${nanoid(4)}`,
      projectId,
      action: TriggerAction.SEND_SLACK_MESSAGE,
      actionParams,
      filters: {},
      triggerKind: TriggerKind.AUTOMATION,
      deleted,
      ...(createdAt ? { createdAt } : {}),
    },
  });
  return { id: row.id, projectId, actionParams };
}

/** A bot automation as the legacy provider stored it: the token encrypted. */
export function storeBotAutomation({
  projectId,
  token,
}: {
  projectId: string;
  token?: string;
}): Promise<StoredAutomation> {
  return storeSlackAutomation({
    projectId,
    actionParams: {
      slackDelivery: "bot",
      slackChannelId: "C0123",
      ...(token ? { slackBotToken: encrypt(token) } : {}),
    },
  });
}

/** A webhook automation as the legacy provider stored it: the URL in plaintext. */
export function storeWebhookAutomation({
  projectId,
  url,
  createdAt,
}: {
  projectId: string;
  url: string;
  createdAt?: Date;
}): Promise<StoredAutomation> {
  return storeSlackAutomation({
    projectId,
    actionParams: { slackDelivery: "webhook", slackWebhook: url },
    createdAt,
  });
}

/** A connection as the settings page stores one. */
export function storeSlackConnection({
  organizationId,
  kind,
  scopeType,
  scopeId,
  secret,
  name,
}: {
  organizationId: string;
  kind: SlackIntegrationKind;
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
  secret: string;
  name: string;
}): Promise<SlackIntegration> {
  const isBot = kind === SlackIntegrationKind.BOT;
  return prisma.slackIntegration.create({
    data: {
      name,
      kind,
      scopeType,
      scopeId,
      organizationId,
      botTokenEncrypted: isBot ? encrypt(secret) : null,
      webhookUrlEncrypted: isBot ? null : encrypt(secret),
      secretFingerprint: slackSecretFingerprint({ secret }),
      secretHint: slackSecretHint({ secret }),
      createdById: "user-settings",
      updatedById: "user-settings",
    },
  });
}

export function findConnections({
  organizationId,
}: {
  organizationId: string;
}): Promise<SlackIntegration[]> {
  return prisma.slackIntegration.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

export function readAutomation({
  id,
  projectId,
}: {
  id: string;
  projectId: string;
}) {
  return prisma.trigger.findFirstOrThrow({
    where: { id, projectId },
    select: { actionParams: true, updatedAt: true },
  });
}

/**
 * Opens a transaction, runs `work` in it and keeps it open until `release`:
 * its row locks and uncommitted rows stand in for a concurrent writer.
 */
export async function holdTransaction({
  work,
}: {
  work: (tx: Prisma.TransactionClient) => Promise<unknown>;
}): Promise<{ release: () => void; committed: Promise<void> }> {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const holding = new Promise<void>((resolve) => {
    started = resolve;
  });
  const committed = prisma.$transaction(
    async (tx) => {
      await work(tx);
      started();
      await released;
    },
    { timeout: 30_000 },
  );
  await Promise.race([holding, committed]);
  return { release, committed };
}

/** Resolves once some session in this database is waiting on a lock. */
export async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
      -- @tenancy: test probe of lock waits across the throwaway database
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()`;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no session ever waited on a lock");
}
