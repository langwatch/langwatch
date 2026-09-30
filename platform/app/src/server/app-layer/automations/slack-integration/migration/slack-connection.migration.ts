import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";

import { migrateOrganization } from "~/tasks/migrateSlackConnections";
import { prisma } from "../../../../db";

/** ADR-093 §5a at startup: the `migrateSlackConnections --apply` pass, per organization. */
export class SlackConnectionMigration implements SystemMigration {
  // Never rename: the stable state-table key.
  readonly name = "automations-slack-connections";
  readonly title = "Slack connections";
  readonly description =
    "Moves each Slack automation's stored secret onto a Slack connection. Delivery does not change.";
  readonly requiresOperatorConfirmation = false;
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    const teams = await prisma.team.findMany({
      where: { organizationId: tenantId },
      select: { id: true },
    });
    const projects = await prisma.project.findMany({
      where: { teamId: { in: teams.map((team) => team.id) } },
      select: { id: true },
    });
    const outcome = await migrateOrganization({
      organizationId: tenantId,
      projectIds: projects.map((project) => project.id),
      apply: true,
    });
    return {
      status: "finalized",
      report: {
        linked: outcome.linkedIds.length,
        cleared: outcome.clearedIds.length,
        skipped: outcome.skipped.length,
      },
    };
  }
}
