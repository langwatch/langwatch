// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { OrganizationApi } from "@langwatch/organization-contract";
import { defineChannels, type BoundApis } from "@langwatch/process";
import { internalSlackSignupsWebhook, type ScopedSecrets } from "@langwatch/secrets";

import { MemoryScimSyncSummaryChannel } from "./memory/memory.scim-sync-summary.channel.ts";
import type { ScimSyncSummaryChannel } from "./scim-sync-summary.channel.ts";
import { SlackScimSyncSummaryChannel } from "./slack/slack.scim-sync-summary.channel.ts";

/** Every channel bound to a module that SCIM holds, as the container hands them to the class. */
export interface ScimChannels {
  /** A deleted directory user leaves through organization, which owns the membership row. */
  readonly members: Pick<OrganizationApi, "deleteMember">;
  /** Absent where SLACK_CHANNEL_SIGNUPS is unset: each push summary is skipped with a warning. */
  readonly syncSummaries: ScimSyncSummaryChannel | undefined;
}

/** Both tiers bind organization: a binding to a module is no peer (record §5). */
class LiveScimChannels {
  static readonly requires = [] as const;
  static readonly binds = { members: OrganizationApi } as const;

  static async create({
    secrets,
    bound,
  }: {
    secrets: ScopedSecrets;
    bound: BoundApis<typeof LiveScimChannels.binds>;
  }): Promise<ScimChannels> {
    const syncSummaries = await secrets.into(internalSlackSignupsWebhook, (webhookUrl) =>
      webhookUrl ? SlackScimSyncSummaryChannel.create({ webhookUrl }) : undefined,
    );
    return { members: bound.members, syncSummaries };
  }
}

/** Push summaries are recorded in-process for a test to read back. */
class MemoryScimChannels {
  static readonly requires = [] as const;
  static readonly binds = { members: OrganizationApi } as const;

  static create({ bound }: { bound: BoundApis<typeof MemoryScimChannels.binds> }): ScimChannels {
    return { members: bound.members, syncSummaries: MemoryScimSyncSummaryChannel.create() };
  }
}

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const scimChannels = defineChannels({
  live: LiveScimChannels,
  memory: MemoryScimChannels,
});
