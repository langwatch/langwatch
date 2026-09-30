import type { SlackConnectionKind, SlackConnectionList } from "@langwatch/slack-contract";

import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryTriggerRepository } from "../../repositories/memory/memory.trigger.repository.ts";
import { AutomationSlackConnectionService } from "../../services/automation-slack-connection.service.ts";
import { SlackConnectionMigrationService } from "../../services/slack-connection-migration.service.ts";
import { SlackConnectionMigration } from "../legacy-import.slack-connection.migration.ts";

export const ORGANIZATION_ID = "org-slack";
export const PROJECT_ID = "project-slack";
export const OTHER_PROJECT_ID = "project-other";

// Built at runtime so no fixture reads as a real credential.
export const WEBHOOK_URL = ["https://hooks.slack.com", "services", "T0", "B0", "hook"].join("/");
export const BOT_TOKEN = ["xoxb", "fixture", "tokn"].join("-");

/** Stores what it is given behind a marker, so a ciphertext is told from plaintext. */
export const fixtureCrypto = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("enc:")) throw new Error("not a ciphertext of this fixture");
    return value.slice(4);
  },
};

interface StoredConnection {
  id: string;
  name: string;
  kind: SlackConnectionKind;
  projectId: string;
  secret: string;
  /** Held for the whole organization, reaching every project. */
  organizationWide?: boolean;
}

/** Slack's side, in memory: connections by secret, and who claims which. */
export class SlackTwin {
  readonly connections: StoredConnection[] = [];
  readonly claims = new Map<string, Set<string>>();
  readonly actors: string[] = [];
  /** Runs once, after the pass planned and before it stores anything: another writer's moment. */
  beforeStore: (() => Promise<void>) | undefined;

  addConnection(connection: StoredConnection): void {
    this.connections.push(connection);
  }

  async listSlackConnections({ projectId }: { projectId: string }): Promise<SlackConnectionList> {
    const now = new Date(0);
    return {
      canManageProject: false,
      canManageOrganization: false,
      connections: this.connections
        .filter((connection) => connection.organizationWide || connection.projectId === projectId)
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          kind: connection.kind,
          scopeType: connection.organizationWide ? "ORGANIZATION" : "PROJECT",
          scopeId: connection.organizationWide ? ORGANIZATION_ID : connection.projectId,
          scopeName: connection.projectId,
          secretHint: connection.secret.slice(-4),
          slackTeamId: null,
          slackTeamName: null,
          dependentAutomations: this.claims.get(connection.id)?.size ?? 0,
          createdAt: now,
          updatedAt: now,
          canManage: false,
        })),
    };
  }

  async findOrCreateSlackConnectionForSecret(input: {
    organizationId: string;
    projectId: string;
    kind: SlackConnectionKind;
    secret: string;
    actorId: string;
  }): Promise<{ id: string; wasCreated: boolean }> {
    this.actors.push(input.actorId);
    const rival = this.beforeStore;
    this.beforeStore = undefined;
    await rival?.();
    const [held] = this.connections.filter(
      (connection) =>
        connection.secret === input.secret &&
        (connection.organizationWide || connection.projectId === input.projectId),
    );
    if (held) return { id: held.id, wasCreated: false };
    const id = `conn-${this.connections.length + 1}`;
    this.connections.push({
      id,
      name: id,
      kind: input.kind,
      projectId: input.projectId,
      secret: input.secret,
    });
    return { id, wasCreated: true };
  }

  async claimConnection({
    connectionId,
    claimant,
  }: {
    connectionId: string;
    claimant: { id: string };
  }): Promise<void> {
    const holders = this.claims.get(connectionId) ?? new Set<string>();
    holders.add(claimant.id);
    this.claims.set(connectionId, holders);
  }

  async releaseConnection({
    connectionId,
    claimantId,
  }: {
    connectionId: string;
    claimantId: string;
  }): Promise<void> {
    this.claims.get(connectionId)?.delete(claimantId);
  }

  async getUsableSlackConnection(): Promise<never> {
    throw new Error("the migration never reads a connection view");
  }
}

/** One organization with two projects, its Slack automations and the migration over them. */
export function slackMigrationWorld({
  archivedProjectIds = [],
}: { archivedProjectIds?: string[] } = {}) {
  const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
  const slack = new SlackTwin();
  const projects = {
    listByOrganization: async ({ organizationId }: { organizationId: string }) => {
      const data = organizationId === ORGANIZATION_ID ? [PROJECT_ID, OTHER_PROJECT_ID] : [];
      return {
        data: data.map((id) => ({
          id,
          archivedAt: archivedProjectIds.includes(id) ? new Date(0) : null,
        })),
        pagination: { page: 1, limit: 500, total: data.length },
      };
    },
  };
  const slackConnections = AutomationSlackConnectionService.create({
    slack,
    projects: { getOrganizationId: async () => ORGANIZATION_ID },
    crypto: fixtureCrypto,
  });
  const migration = SlackConnectionMigration.create({
    pass: SlackConnectionMigrationService.create({
      triggers,
      projects,
      slack,
      slackConnections,
      crypto: fixtureCrypto,
    }),
  });

  async function addAutomation({
    id,
    actionParams,
    projectId = PROJECT_ID,
    active = true,
  }: {
    id: string;
    actionParams: Record<string, unknown>;
    projectId?: string;
    active?: boolean;
  }) {
    await triggers.create({
      id,
      projectId,
      name: `Automation ${id}`,
      action: "SEND_SLACK_MESSAGE",
      actionParams,
    });
    if (!active) await triggers.update({ id, projectId, active: false });
  }

  return { triggers, slack, migration, addAutomation };
}
