import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  ACCESS_DIGEST_PROCESS_NAME,
  runAccessDigestSweep,
} from "./organization-access-digest.intent.ts";
import {
  ACCESS_DIGEST_INITIAL_STATE,
  ACCESS_DIGEST_INTERVAL_MS,
  accessDigestSendSchema,
  accessDigestStateSchema,
  accessDigestWake,
} from "./organization-access-digest.process.ts";

export const ACCESS_DIGEST_PIPELINE_NAME = "organization_access_notice_digest";

/** Mails the held seat request and refused sign-in notices once across the fleet. */
export function buildAccessDigest({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<OrganizationModule, "sendAccessNoticeDigests">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: ACCESS_DIGEST_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(ACCESS_DIGEST_PROCESS_NAME, (pm) =>
      pm
        .state(accessDigestStateSchema, ACCESS_DIGEST_INITIAL_STATE)
        .schedule({ everyMs: ACCESS_DIGEST_INTERVAL_MS })
        .onWake(accessDigestWake)
        .intent(
          "send",
          accessDigestSendSchema,
          runAccessDigestSweep({
            send: () => app.sendAccessNoticeDigests(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const accessDigestEventing = defineEventingModule({
  pipeline: ACCESS_DIGEST_PIPELINE_NAME,
  build: (setup: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    buildAccessDigest(setup),
});
