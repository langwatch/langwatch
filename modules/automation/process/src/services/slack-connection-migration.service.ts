import type { Project, ProjectApi } from "@langwatch/project-contract";
import type { SlackApi } from "@langwatch/slack-contract";
import { z } from "zod";

import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { OrganizationMigrationOutcome } from "../rules/slack-connection-migration-report.rules.ts";
import {
  planSlackConnectionMigration,
  withoutLegacySlackSecret,
  type MigrationAutomation,
  type OrganizationMigrationPlan,
  type PlannedConnection,
  type ProjectBotConnection,
  type SkippedAutomation,
} from "../rules/slack-connection-migration.rules.ts";
import type { AutomationSlackConnectionService } from "./automation-slack-connection.service.ts";

/** Who a migrated connection is stored for; main's fallback actor. */
const MIGRATION_ACTOR_ID = "system:migration";
const PROJECT_PAGE_SIZE = 500;

/** An automation whose delivery points at a connection. */
const onConnectionSchema = z.object({ slackIntegrationId: z.string().min(1) });

type MigrationSlack = Pick<
  SlackApi,
  "listSlackConnections" | "findOrCreateSlackConnectionForSecret"
>;
type MigrationProject = Pick<Project, "id" | "archivedAt">;

/** The organization's projects, as far as the pass reads them; `ProjectApi` answers it. */
interface MigrationProjects {
  listByOrganization(input: Parameters<ProjectApi["listByOrganization"]>[0]): Promise<{
    data: MigrationProject[];
    pagination: { limit: number; total: number };
  }>;
}

/** The trigger rows a pass reads and rewrites, and the open of a stored token. */
type MigrationTriggers = Pick<
  TriggerRepository,
  "findSlackTriggers" | "replaceActionParamsIfUnchanged" | "openSecret"
>;

/**
 * One organization's Slack connection pass (ARCHITECTURE.md §7): plan with the
 * pure rules, move each secret forward through `SlackApi`, clear what is left,
 * then claim every active Slack automation's connection (the backfill).
 */
export class SlackConnectionMigrationService {
  private constructor(
    private readonly deps: {
      triggers: MigrationTriggers;
      projects: MigrationProjects;
      slack: MigrationSlack;
      slackConnections: Pick<AutomationSlackConnectionService, "updateConnectionClaim">;
    },
  ) {}

  static create(deps: {
    triggers: MigrationTriggers;
    projects: MigrationProjects;
    slack: MigrationSlack;
    slackConnections: Pick<AutomationSlackConnectionService, "updateConnectionClaim">;
  }): SlackConnectionMigrationService {
    return new SlackConnectionMigrationService(deps);
  }

  async migrateOrganization({
    organizationId,
    signal,
  }: {
    organizationId: string;
    signal?: AbortSignal;
  }): Promise<OrganizationMigrationOutcome> {
    const plan = await this.planOrganization({ organizationId });
    // An aborted pass stops before it writes anything.
    signal?.throwIfAborted();
    const linked = await this.linkPlannedMembers({ plan });
    const cleared = await this.clearPlannedSecrets({ plan });
    const claimed = await this.claimConnections({ projectIds: plan.projectIds });
    return {
      plan,
      linkedIds: linked.linkedIds,
      clearedIds: cleared.clearedIds,
      skipped: [...plan.skipped, ...linked.changed, ...cleared.changed],
      claimed,
    };
  }

  private async planOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMigrationPlan & { projectIds: string[] }> {
    const projects = await this.listProjects({ organizationId });
    const projectIds = projects.map((project) => project.id);
    const automations: MigrationAutomation[] = await this.deps.triggers.findSlackTriggers({
      projectIds,
    });
    const projectBots = await this.projectBots({
      projectIds: [...new Set(automations.map((automation) => automation.projectId))],
    });
    const plan = planSlackConnectionMigration({
      organizationId,
      automations,
      archivedProjectIds: projects
        .filter((project) => project.archivedAt)
        .map((project) => project.id),
      projectBots,
      decryptSecret: ({ ciphertext }) => this.deps.triggers.openSecret({ sealed: ciphertext }),
    });
    return { ...plan, projectIds };
  }

  /** Every project of the organization, governance included: a trigger can live on any. */
  private async listProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<MigrationProject[]> {
    const projects: MigrationProject[] = [];
    let pageCount = 1;
    for (let page = 1; page <= pageCount; page += 1) {
      const { data, pagination } = await this.deps.projects.listByOrganization({
        organizationId,
        page,
        limit: PROJECT_PAGE_SIZE,
        includeGovernance: true,
      });
      projects.push(...data);
      pageCount = data.length === 0 ? 0 : Math.ceil(pagination.total / pagination.limit);
    }
    return projects;
  }

  /** Each project's own bot connections, which a tokenless bot automation joins. */
  private async projectBots({
    projectIds,
  }: {
    projectIds: string[];
  }): Promise<ProjectBotConnection[]> {
    const bots: ProjectBotConnection[] = [];
    for (const projectId of projectIds) {
      const { connections } = await this.deps.slack.listSlackConnections({ projectId });
      for (const connection of connections) {
        if (
          connection.kind === "BOT" &&
          connection.scopeType === "PROJECT" &&
          connection.scopeId === projectId
        ) {
          bots.push({ id: connection.id, name: connection.name, projectId });
        }
      }
    }
    return bots;
  }

  /** Stores or joins each planned connection and links its members; the rest report changed. */
  private async linkPlannedMembers({
    plan,
  }: {
    plan: OrganizationMigrationPlan;
  }): Promise<{ linkedIds: string[]; changed: SkippedAutomation[] }> {
    const linkedIds: string[] = [];
    const changed: SkippedAutomation[] = [];
    for (const connection of plan.connections) {
      const connectionId = await this.connectionIdFor({
        connection,
        organizationId: plan.organizationId,
      });
      for (const automation of connection.members) {
        const moved = await this.deps.triggers.replaceActionParamsIfUnchanged({
          triggerId: automation.id,
          projectId: automation.projectId,
          expected: automation.actionParams,
          actionParams: withoutLegacySlackSecret({
            actionParams: automation.actionParams,
            connectionId,
          }),
        });
        if (moved) linkedIds.push(automation.id);
        else changed.push({ automation, reason: "changed during migration" });
      }
    }
    return { linkedIds, changed };
  }

  private async connectionIdFor({
    connection,
    organizationId,
  }: {
    connection: PlannedConnection;
    organizationId: string;
  }): Promise<string> {
    if (connection.action === "join") return connection.connectionId;
    const { id } = await this.deps.slack.findOrCreateSlackConnectionForSecret({
      organizationId,
      projectId: connection.projectId,
      kind: connection.kind,
      secret: connection.secret,
      actorId: MIGRATION_ACTOR_ID,
    });
    return id;
  }

  /** Clears each already-linked automation's own secret; the rest are reported changed. */
  private async clearPlannedSecrets({
    plan,
  }: {
    plan: OrganizationMigrationPlan;
  }): Promise<{ clearedIds: string[]; changed: SkippedAutomation[] }> {
    const clearedIds: string[] = [];
    const changed: SkippedAutomation[] = [];
    for (const automation of plan.cleared) {
      const cleared = await this.deps.triggers.replaceActionParamsIfUnchanged({
        triggerId: automation.id,
        projectId: automation.projectId,
        expected: automation.actionParams,
        actionParams: withoutLegacySlackSecret({ actionParams: automation.actionParams }),
      });
      if (cleared) clearedIds.push(automation.id);
      else changed.push({ automation, reason: "changed during migration" });
    }
    return { clearedIds, changed };
  }

  /** Claims the connection of every active Slack automation; idempotent, so every pass may. */
  private async claimConnections({ projectIds }: { projectIds: string[] }): Promise<number> {
    let claimed = 0;
    for (const trigger of await this.deps.triggers.findSlackTriggers({ projectIds })) {
      if (!trigger.active) continue;
      const after = { actionParams: trigger.actionParams, active: true };
      await this.deps.slackConnections.updateConnectionClaim({
        projectId: trigger.projectId,
        trigger: { id: trigger.id, name: trigger.name },
        before: undefined,
        after,
      });
      if (onConnectionSchema.validate(trigger.actionParams)) claimed += 1;
    }
    return claimed;
  }
}
