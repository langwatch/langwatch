// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { scimSyncSummaryNotice } from "@langwatch/internal-slack";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ScimSyncSummaryChannel } from "../channels/scim-sync-summary.channel.ts";
import type { ScimSyncSummary } from "../eventing/scim-sync-summary.process.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";

const DEFAULT_APP_URL = "https://app.langwatch.ai";

type ScimSyncSummaryDeps = Readonly<{
  /** Absent where SLACK_CHANNEL_SIGNUPS is unset: each summary is skipped with a warning. */
  channel: ScimSyncSummaryChannel | undefined;
  publicBaseUrl: string | undefined;
  /** The organization's name and the directory's own names for the people it added. */
  directory: Pick<ScimRepository, "findOrganizationNames" | "findUserResource">;
  logger: Pick<Logger, "warn" | "error">;
  now?: () => number;
}>;

/** One directory push, summarised on LangWatch's own sign-ups channel. */
export class ScimSyncSummaryService {
  private constructor(private readonly deps: ScimSyncSummaryDeps) {}

  static create(deps: ScimSyncSummaryDeps): ScimSyncSummaryService {
    return new ScimSyncSummaryService(deps);
  }

  /** A failed post is logged, never thrown: a retry would only risk a second card. */
  async post(summary: ScimSyncSummary): Promise<void> {
    const { channel, publicBaseUrl, directory, logger } = this.deps;
    if (!channel) {
      logger.warn("SLACK_CHANNEL_SIGNUPS is not configured; skipping SCIM sync summary");
      return;
    }
    const { organizationId, addedUserIds } = summary;
    const [organization] = await directory.findOrganizationNames({
      organizationIds: [organizationId],
    });
    const resources = await Promise.all(
      addedUserIds.map((userId) => directory.findUserResource({ organizationId, userId })),
    );
    const appUrl = publicBaseUrl ?? DEFAULT_APP_URL;
    const message = scimSyncSummaryNotice.render({
      props: {
        organizationId,
        organizationName: organization?.name ?? organizationId,
        added: summary.added,
        updated: summary.updated,
        deactivated: summary.deactivated,
        failed: summary.failed,
        addedNames: resources.flatMap((resource) =>
          resource ? [resource.name ?? resource.userName] : [],
        ),
        appUrl,
      },
      origin: {
        environment: new URL(appUrl).host,
        sentAt: (this.deps.now ?? (() => nowInstant().epochMilliseconds))(),
      },
    });
    try {
      await channel.post(message);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : String(error) },
        "SCIM sync summary could not be posted to Slack",
      );
    }
  }
}
