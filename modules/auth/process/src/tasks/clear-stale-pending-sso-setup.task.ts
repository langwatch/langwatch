import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { PrismaBetterAuthHooksRepository } from "../repositories/prisma/prisma.better-auth-hooks.repository.ts";
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

  private constructor(private readonly database: () => PrismaPendingSsoSetupDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => PrismaPendingSsoSetupDatabase;
  }): ClearStalePendingSsoSetupTask {
    return new ClearStalePendingSsoSetupTask(database);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const prisma = this.database();
    const hooks = PrismaBetterAuthHooksRepository.create(prisma);
    const result = await PendingSsoSetupCleanupService.create({
      candidates: PrismaPendingSsoSetupRepository.create(prisma),
      organizations: {
        findByDomain: (input) =>
          hooks.getOrganizationBySsoDomain(input).catch((error: unknown) => {
            if (HandledError.isHandled(error) && error.code === "organization_not_found")
              return null;
            throw error;
          }),
      },
    }).clearStale({ isDryRun: args.includes("--dry-run") });

    logger.info(result, "finished clearing stale pending SSO setup flags");
  }
}
