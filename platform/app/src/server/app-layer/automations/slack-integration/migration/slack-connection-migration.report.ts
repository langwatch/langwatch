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
  skipped: SkippedAutomation[];
}

export interface SlackMigrationTally {
  created: number;
  reused: number;
  widened: number;
  linked: number;
  skipped: Partial<Record<SlackMigrationSkipReason, number>>;
}

/** A dry run's outcome: every planned member would be linked. */
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
    skipped: plan.skipped,
  };
}

function countConnection({
  tally,
  connection,
}: {
  tally: SlackMigrationTally;
  connection: PlannedConnection;
}): void {
  if (connection.action === "create") {
    tally.created += 1;
    return;
  }
  tally.reused += 1;
  if (connection.widenedFromProjectId) tally.widened += 1;
}

export function tallyOutcomes({
  outcomes,
}: {
  outcomes: OrganizationMigrationOutcome[];
}): SlackMigrationTally {
  const tally: SlackMigrationTally = {
    created: 0,
    reused: 0,
    widened: 0,
    linked: 0,
    skipped: {},
  };
  for (const { plan, linkedIds, skipped } of outcomes) {
    for (const connection of plan.connections) {
      countConnection({ tally, connection });
    }
    tally.linked += linkedIds.length;
    for (const { reason } of skipped) {
      tally.skipped[reason] = (tally.skipped[reason] ?? 0) + 1;
    }
  }
  return tally;
}

function scopeLabel({ connection }: { connection: PlannedConnection }): string {
  return connection.scopeType === SlackIntegrationScopeType.ORGANIZATION
    ? "organization"
    : `project ${connection.scopeId}`;
}

/** One connection's line. Names carry only the hint, never the secret. */
function connectionLine({
  connection,
}: {
  connection: PlannedConnection;
}): string {
  const kind = connection.kind === SlackIntegrationKind.BOT ? "bot" : "webhook";
  const count = `${connection.members.length} automation${connection.members.length === 1 ? "" : "s"}`;
  const scope = scopeLabel({ connection });
  if (connection.action === "create") {
    return `  create  "${connection.name}"  ${kind}  ${scope}  ${count}`;
  }
  const widened = connection.widenedFromProjectId
    ? `  (widened from project ${connection.widenedFromProjectId})`
    : "";
  return `  reuse   "${connection.name}" (${connection.connectionId})  ${kind}  ${scope}  ${count}${widened}`;
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
  return `Connections created ${tally.created}, reused ${tally.reused}, widened ${tally.widened}; automations linked ${tally.linked}, skipped ${skipped}`;
}
