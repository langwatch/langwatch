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
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: tenantId } },
      select: { id: true },
    });
    signal?.throwIfAborted();
    const outcome = await migrateOrganization({
      organizationId: tenantId,
      projectIds: projects.map((project) => project.id),
      apply: true,
    });
    const linked = outcome.linkedIds.length;
    const cleared = outcome.clearedIds.length;
    const report = { linked, cleared, skipped: outcome.skipped.length };
    // Wrote something: re-plan next pass to catch rows changed mid-run.
    if (linked + cleared > 0) return { status: "migrated", report };
    return { status: "finalized", report };
  }
}
