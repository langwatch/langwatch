/**
 * The `ops.*` procedures the group-queue and dead-letter pages call, declared
 * once. Reads list what is blocked, parked or retired; writes unblock, drain,
 * retire and replay it.
 *
 * One of five declarations under the same `ops` namespace - see
 * `ops-dashboard.trpc.ts` for why the surface is declared in five parts.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { groupInfoSchema } from "./ops-dashboard.ts";
import {
  opsBlockedSummarySchema,
  opsDrainQueueTenantInputSchema,
  opsListQueueGroupJobsInputSchema,
  opsListQueueGroupsInputSchema,
  opsQueueCanaryInputSchema,
  opsQueueDlqGroupSchema,
  opsQueueDlqGroupWithQueueSchema,
  opsQueueDrainPreviewSchema,
  opsQueueFilterInputSchema,
  opsQueueGroupIdsInputSchema,
  opsQueueGroupInputSchema,
  opsQueueGroupsPageSchema,
  opsQueueJobsPageSchema,
  opsQueueNameInputSchema,
  opsQueuePipelineInputSchema,
  opsQueueTenantInputSchema,
  opsRetryBlockedQueueJobInputSchema,
} from "./ops-queue.ts";
import {
  opsGrafanaLinkConfigSchema,
  opsPipelineRegistrationsSchema,
  opsQueueCanaryRedrivenSchema,
  opsQueueCanaryUnblockedSchema,
  opsQueueDiscardedDlqGroupsSchema,
  opsQueueDrainedGroupSchema,
  opsQueueDrainedTenantSchema,
  opsQueueMovedAllToDlqSchema,
  opsQueueMovedToDlqSchema,
  opsQueueNameListSchema,
  opsQueueRedrivenDlqGroupsSchema,
  opsQueueReplayedAllFromDlqSchema,
  opsQueueReplayedFromDlqSchema,
  opsQueueUnblockedAllSchema,
  opsQueueUnblockedGroupSchema,
} from "./ops.responses.ts";

export const opsQueueTrpc = defineTrpcContract("ops")
  .query("listGroups")
  .withInput(opsListQueueGroupsInputSchema)
  .withOutput(opsQueueGroupsPageSchema)

  .query("getGroupDetail")
  .withInput(opsQueueGroupInputSchema)
  .withOutput(groupInfoSchema)

  /**
   * The Grafana deep-link configuration, so ops surfaces can build per-row
   * Explore links client-side. Null when no Grafana is configured, so callers
   * render no link rather than a dead one. Grafana is access-controlled in its
   * own right, so the base URL is not a secret to an operator.
   */
  .query("getGrafanaLinkConfig")
  .withInput(z.void())
  .withOutput(opsGrafanaLinkConfigSchema)

  .query("getBlockedSummary")
  .withInput(z.void())
  .withOutput(opsBlockedSummarySchema)

  .query("getGroupJobs")
  .withInput(opsListQueueGroupJobsInputSchema)
  .withOutput(opsQueueJobsPageSchema)

  .mutation("unblockGroup")
  .withInput(opsQueueGroupInputSchema)
  .withOutput(opsQueueUnblockedGroupSchema)

  .mutation("unblockAll")
  .withInput(opsQueueNameInputSchema)
  .withOutput(opsQueueUnblockedAllSchema)

  .mutation("drainGroup")
  .withInput(opsQueueGroupInputSchema)
  .withOutput(opsQueueDrainedGroupSchema)

  .mutation("pausePipeline")
  .withInput(opsQueuePipelineInputSchema)
  .withOutput(z.void())

  .mutation("unpausePipeline")
  .withInput(opsQueuePipelineInputSchema)
  .withOutput(z.void())

  .mutation("pauseTenant")
  .withInput(opsQueueTenantInputSchema)
  .withOutput(z.void())

  .mutation("unpauseTenant")
  .withInput(opsQueueTenantInputSchema)
  .withOutput(z.void())

  .query("listPausedTenants")
  .withInput(opsQueueNameInputSchema)
  .withOutput(opsQueueNameListSchema)

  .mutation("drainTenant")
  .withInput(opsDrainQueueTenantInputSchema)
  .withOutput(opsQueueDrainedTenantSchema)

  .mutation("retryBlocked")
  .withInput(opsRetryBlockedQueueJobInputSchema)
  .withOutput(opsQueueUnblockedGroupSchema)

  .query("listProjections")
  .withInput(z.void())
  .withOutput(opsPipelineRegistrationsSchema)

  .query("listDlqGroups")
  .withInput(opsQueueNameInputSchema)
  .withOutput(opsQueueDlqGroupSchema.array())

  .query("listAllDlqGroups")
  .withInput(z.void())
  .withOutput(opsQueueDlqGroupWithQueueSchema.array())

  .query("listPausedKeys")
  .withInput(opsQueueNameInputSchema)
  .withOutput(opsQueueNameListSchema)

  .query("drainAllBlockedPreview")
  .withInput(opsQueueFilterInputSchema)
  .withOutput(opsQueueDrainPreviewSchema)

  .mutation("moveToDlq")
  .withInput(opsQueueGroupInputSchema)
  .withOutput(opsQueueMovedToDlqSchema)

  .mutation("moveAllBlockedToDlq")
  .withInput(opsQueueFilterInputSchema)
  .withOutput(opsQueueMovedAllToDlqSchema)

  .mutation("replayFromDlq")
  .withInput(opsQueueGroupInputSchema)
  .withOutput(opsQueueReplayedFromDlqSchema)

  .mutation("replayAllFromDlq")
  .withInput(opsQueueFilterInputSchema)
  .withOutput(opsQueueReplayedAllFromDlqSchema)

  /**
   * Redrive exactly the DLQ groups the operator's filter showed
   * (specs/ops/dead-letter-recovery.feature): explicit ids, so the
   * confirmation and the act cover the same groups.
   */
  .mutation("redriveManyFromDlq")
  .withInput(opsQueueGroupIdsInputSchema)
  .withOutput(opsQueueRedrivenDlqGroupsSchema)

  /**
   * Discard exactly the shown DLQ groups: their jobs never run again. The
   * audit row is the retained mark - the Redis entries expire regardless.
   */
  .mutation("discardManyFromDlq")
  .withInput(opsQueueGroupIdsInputSchema)
  .withOutput(opsQueueDiscardedDlqGroupsSchema)

  .mutation("canaryRedrive")
  .withInput(opsQueueCanaryInputSchema)
  .withOutput(opsQueueCanaryRedrivenSchema)

  .mutation("canaryUnblock")
  .withInput(opsQueueCanaryInputSchema)
  .withOutput(opsQueueCanaryUnblockedSchema)
  .build();
