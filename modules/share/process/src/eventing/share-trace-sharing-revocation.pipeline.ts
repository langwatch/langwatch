import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
/**
 * Share revokes a project's trace links from its own side once project records trace sharing
 * disabled (§9, R7), so project holds no share peer. Spec: modules/share/specs/share.feature
 */
import {
  PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE,
  projectTraceSharingDisabledEventDataSchema,
} from "@langwatch/project-contract";

import type { ShareModule } from "../app/share.app.ts";
import type { ShareRepositories } from "../repositories/share.repositories.ts";
import type { ShareService } from "../services/share.service.ts";

const SHARE_TRACE_SHARING_REVOCATION_PIPELINE_NAME = "share_trace_sharing_revocation" as const;

const disabledAtOf = projectTraceSharingDisabledEventDataSchema.pick({ occurredAt: true });

export type ShareTraceSharingRevocationPipeline = StaticPipelineDefinition<never>;

export function buildShareTraceSharingRevocationPipeline({
  shares,
}: {
  shares: Pick<ShareService, "revokeAllTraceShares">;
}): ShareTraceSharingRevocationPipeline {
  return (
    definePipeline({
      name: SHARE_TRACE_SHARING_REVOCATION_PIPELINE_NAME,
      // `global`: share appends no events of its own here; it only reacts to project's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The revoke re-reads the project's trace links, so a redelivery finds none to remove.
      .withPeerSubscriber("shareProjectTraceSharingDisabled", {
        eventType: PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE,
        data: projectTraceSharingDisabledEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `share-trace-sharing-disabled:${event.tenantId}:${String(event.aggregateId)}:${disabledAtOf.parse(event.data).occurredAt}`,
            ttlMs: 60_000,
          },
        },
        handle: ({ projectId }) => shares.revokeAllTraceShares(projectId),
      })
      .build()
  );
}

export const shareTraceSharingRevocationEventing = defineEventingModule({
  pipeline: SHARE_TRACE_SHARING_REVOCATION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<ShareRepositories, ShareModule>) => app.revocationPipeline(),
});
