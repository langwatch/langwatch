import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";

import { slackMigrationReport } from "../rules/slack-connection-migration-report.rules.ts";
import type { SlackConnectionMigrationService } from "../services/slack-connection-migration.service.ts";

/**
 * Moves each organization's legacy Slack secrets onto connections and claims
 * every active Slack automation's connection, one pass per organization
 * (ARCHITECTURE.md §7). Ops runs it; its page is the dry run.
 */
export class SlackConnectionMigration implements SystemMigration {
  // Never rename: the stable state-table key.
  readonly name = "automations-slack-connections";
  readonly title = "Slack connections";
  readonly description =
    "Moves each Slack automation's stored secret onto a Slack connection. Delivery does not change.";
  readonly requiresOperatorConfirmation = false;
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;

  private constructor(
    private readonly pass: Pick<SlackConnectionMigrationService, "migrateOrganization">,
  ) {}

  static create({
    pass,
  }: {
    pass: Pick<SlackConnectionMigrationService, "migrateOrganization">;
  }): SlackConnectionMigration {
    return new SlackConnectionMigration(pass);
  }

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const outcome = await this.pass.migrateOrganization({ organizationId: tenantId, signal });
    const report = slackMigrationReport({ outcome });
    // Wrote something: re-plan next pass to catch rows changed mid-run. Claims alone never count.
    if (report.linked + report.cleared > 0) return { status: "migrated", report };
    return { status: "finalized", report };
  }
}
