import type {
  OrganizationMigrationPlan,
  SkippedAutomation,
  SlackMigrationSkipReason,
} from "./slack-connection-migration.rules.ts";

/** What one organization's pass did. */
export interface OrganizationMigrationOutcome {
  plan: OrganizationMigrationPlan;
  linkedIds: string[];
  /** Already on a connection; their own secret was cleared. */
  clearedIds: string[];
  skipped: SkippedAutomation[];
  /** Connections of active Slack automations claimed this pass (the backfill). */
  claimed: number;
}

/** One connection as the ops page reads it: the hint, never the secret. */
export interface SlackMigrationConnectionReport {
  name: string;
  projectId: string;
  secretHint: string | null;
  automations: number;
}

/** The outcome's `report`: counts, skip reasons and secret hints only. */
export interface SlackMigrationReport {
  linked: number;
  cleared: number;
  skipped: number;
  claimed: number;
  skippedReasons: Partial<Record<SlackMigrationSkipReason, number>>;
  connections: SlackMigrationConnectionReport[];
}

export function slackMigrationReport({
  outcome,
}: {
  outcome: OrganizationMigrationOutcome;
}): SlackMigrationReport {
  const skippedReasons: Partial<Record<SlackMigrationSkipReason, number>> = {};
  for (const { reason } of outcome.skipped) {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  }
  return {
    linked: outcome.linkedIds.length,
    cleared: outcome.clearedIds.length,
    skipped: outcome.skipped.length,
    claimed: outcome.claimed,
    skippedReasons,
    connections: outcome.plan.connections.map((connection) => ({
      name: connection.name,
      projectId: connection.projectId,
      secretHint: connection.action === "store" ? connection.secretHint : null,
      automations: connection.members.length,
    })),
  };
}
