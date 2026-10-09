import {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import type {
  OrganizationMigrationPlan,
  PlannedConnection,
  SkippedAutomation,
  SlackMigrationSkipReason,
} from "./slack-connection-migration.plan";

/** What one organization's run did (or, on a dry run, would do). */
export interface OrganizationMigrationOutcome {
  plan: OrganizationMigrationPlan;
  linkedIds: string[];
  /** Already on a connection; their own secret was (or would be) cleared. */
  clearedIds: string[];
  skipped: SkippedAutomation[];
}

export interface SlackMigrationTally {
  created: number;
  reused: number;
  linked: number;
  cleared: number;
  skipped: Partial<Record<SlackMigrationSkipReason, number>>;
}

/** A dry run's outcome: every planned member would be linked, every stale secret cleared. */
export function dryRunOutcome({
  plan,
}: {
  plan: OrganizationMigrationPlan;
}): OrganizationMigrationOutcome {
  return {
    plan,
    linkedIds: plan.connections.flatMap((connection) =>
      connection.members.map((member) => member.id),
    ),
    clearedIds: plan.cleared.map((automation) => automation.id),
    skipped: plan.skipped,
  };
}

export function tallyOutcomes({
  outcomes,
}: {
  outcomes: OrganizationMigrationOutcome[];
}): SlackMigrationTally {
  const tally: SlackMigrationTally = {
    created: 0,
    reused: 0,
    linked: 0,
    cleared: 0,
    skipped: {},
  };
  for (const { plan, linkedIds, clearedIds, skipped } of outcomes) {
    for (const connection of plan.connections) {
      if (connection.action === "create") tally.created += 1;
      else tally.reused += 1;
    }
    tally.linked += linkedIds.length;
    tally.cleared += clearedIds.length;
    for (const { reason } of skipped) {
      tally.skipped[reason] = (tally.skipped[reason] ?? 0) + 1;
    }
  }
  return tally;
}

/** One connection's line. Names carry only the hint, never the secret. */
function connectionLine({
  connection,
}: {
  connection: PlannedConnection;
}): string {
  const kind = connection.kind === SlackIntegrationKind.BOT ? "bot" : "webhook";
  const count = `${connection.members.length} automation${connection.members.length === 1 ? "" : "s"}`;
  const scope =
    connection.scopeType === SlackIntegrationScopeType.ORGANIZATION
      ? "organization"
      : `project ${connection.scopeId}`;
  if (connection.action === "create") {
    return `  create  "${connection.name}"  ${kind}  ${scope}  ${count}`;
  }
  return `  reuse   "${connection.name}" (${connection.connectionId})  ${kind}  ${scope}  ${count}`;
}

/** The per-organization block: each connection, the automations it links, then the skips. */
export function formatOrganizationOutcome({
  outcome,
  organizationName,
}: {
  outcome: OrganizationMigrationOutcome;
  organizationName: string;
}): string[] {
  const linked = new Set(outcome.linkedIds);
  const lines = [
    `Organization "${organizationName}" (${outcome.plan.organizationId})`,
  ];
  for (const connection of outcome.plan.connections) {
    lines.push(connectionLine({ connection }));
    for (const member of connection.members.filter((m) => linked.has(m.id))) {
      lines.push(
        `    link  ${member.id} "${member.name}" (project ${member.projectId})`,
      );
    }
  }
  const cleared = new Set(outcome.clearedIds);
  for (const automation of outcome.plan.cleared) {
    if (!cleared.has(automation.id)) continue;
    lines.push(
      `  clear   ${automation.id} "${automation.name}" (project ${automation.projectId})`,
    );
  }
  for (const { automation, reason } of outcome.skipped) {
    lines.push(
      `  skip    ${automation.id} "${automation.name}" (project ${automation.projectId}): ${reason}`,
    );
  }
  return lines;
}

export function formatTally({ tally }: { tally: SlackMigrationTally }): string {
  const reasons = Object.entries(tally.skipped)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
  const skippedTotal = Object.values(tally.skipped).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );
  const skipped = reasons ? `${skippedTotal} (${reasons})` : "0";
  return `Connections created ${tally.created}, reused ${tally.reused}; automations linked ${tally.linked}, cleared ${tally.cleared}, skipped ${skipped}`;
}
