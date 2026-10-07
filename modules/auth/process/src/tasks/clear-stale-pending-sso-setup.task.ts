import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import {
  PrismaPendingSsoSetupRepository,
  type PrismaPendingSsoSetupDatabase,
} from "../repositories/prisma/prisma.pending-sso-setup.repository.ts";
import { PendingSsoSetupCleanupService } from "../services/pending-sso-setup-cleanup.service.ts";

const logger = createLogger("langwatch:task:clear-stale-pending-sso-setup");

/** Main's one-off `clearStalePendingSsoSetup`; `--dry-run` counts and writes nothing. */
export class ClearStalePendingSsoSetupTask extends Task {
  readonly name = "clear-stale-pending-sso-setup";
  readonly description =
    "Clears the single sign-on setup reminder for people who already sign in through the provider their organization requires.";

  private constructor(
    private readonly database: () => PrismaPendingSsoSetupDatabase,
    private readonly organizations: Pick<OrganizationApi, "findBySsoDomain">,
  ) {
    super();
  }

  static create({
    database,
    organizations,
  }: {
    database: () => PrismaPendingSsoSetupDatabase;
    organizations: Pick<OrganizationApi, "findBySsoDomain">;
  }): ClearStalePendingSsoSetupTask {
    return new ClearStalePendingSsoSetupTask(database, organizations);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const prisma = this.database();
    const result = await PendingSsoSetupCleanupService.create({
      candidates: PrismaPendingSsoSetupRepository.create(prisma),
      organizations: { findByDomain: (input) => this.organizations.findBySsoDomain(input) },
    }).clearStale({ isDryRun: args.includes("--dry-run") });

    logger.info(result, "finished clearing stale pending SSO setup flags");
  }
}
