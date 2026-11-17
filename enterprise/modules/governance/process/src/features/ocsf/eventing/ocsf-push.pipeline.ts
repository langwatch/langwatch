// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The OCSF SIEM push: building the pipeline connects the outbox the push service records events
 * in, and its process manager hands each one to WebhookApi. No sweep: an event is recorded when
 * its row is written. Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GovernanceModule } from "../../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../../repositories/governance.repositories.ts";
import { pruneOcsfPushDeliveries } from "./ocsf-push-delivery.intent.ts";
import {
  OCSF_PUSH_INITIAL_STATE,
  OCSF_PUSH_MAX_ATTEMPTS,
  OCSF_PUSH_PROCESS_NAME,
  OCSF_PUSH_PRUNE_INTENT,
  OCSF_PUSH_PRUNE_INTERVAL_MS,
  OCSF_PUSH_REQUEST_INTENT,
  ocsfPushIntentSchema,
  ocsfPushPruneSchema,
  ocsfPushPruneWake,
  ocsfPushStateSchema,
} from "./ocsf-push-delivery.process.ts";

const OCSF_PUSH_PIPELINE_NAME = "governance_ocsf_push";

type OcsfPushApp = Pick<GovernanceModule, "connectOcsfPushOutbox" | "requestOcsfPushDelivery">;

function buildOcsfPushPipeline({
  app,
  processStore,
}: EventingSetup<unknown, OcsfPushApp>): StaticPipelineDefinition<never> {
  app.connectOcsfPushOutbox({ processStore });
  return definePipeline({
    name: OCSF_PUSH_PIPELINE_NAME,
    // `global`: governance appends no events here; it only runs the push outbox.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(OCSF_PUSH_PROCESS_NAME, (pm) =>
      pm
        .state(ocsfPushStateSchema, OCSF_PUSH_INITIAL_STATE)
        .intent(OCSF_PUSH_REQUEST_INTENT, ocsfPushIntentSchema, (intent, context) =>
          app.requestOcsfPushDelivery(intent, context),
        )
        .intent(OCSF_PUSH_PRUNE_INTENT, ocsfPushPruneSchema, pruneOcsfPushDeliveries(processStore))
        .schedule({ everyMs: OCSF_PUSH_PRUNE_INTERVAL_MS })
        .onWake(ocsfPushPruneWake)
        .outbox({ maxAttempts: OCSF_PUSH_MAX_ATTEMPTS }),
    )
    .build();
}

export const ocsfPushEventing = defineEventingModule({
  pipeline: OCSF_PUSH_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    buildOcsfPushPipeline(setup),
});
