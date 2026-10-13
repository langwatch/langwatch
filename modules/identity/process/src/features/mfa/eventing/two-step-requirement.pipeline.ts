import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { IdentityModule } from "../../../app/identity.app.ts";
import type { IdentityRepositories } from "../../../repositories/identity.repositories.ts";
import { runNotifyMembers } from "./two-step-requirement-notice.intent.ts";
import {
  notifyMembersIntentSchema,
  onTwoStepRequirementChanged,
  TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE,
  TWO_STEP_REQUIREMENT_NOTICE_PROCESS_NAME,
  type TwoStepRequirementNotices,
  twoStepRequirementNoticeStateSchema,
} from "./two-step-requirement-notice.process.ts";
import {
  RecordTwoStepRequirementChangedCommand,
  TWO_STEP_REQUIREMENT_AGGREGATE_TYPE,
  TWO_STEP_REQUIREMENT_PIPELINE_NAME,
  twoStepRequirementChangedEventSchema,
} from "./two-step-requirement.intent.ts";

/** Each mail carries a per-member delivery key; one large organization fits the lease. */
const NOTICE_LEASE_MS = 15 * 60 * 1000;
const NOTICE_MAX_ATTEMPTS = 3;

function twoStepRequirementDefinition(deps: { notices: TwoStepRequirementNotices }) {
  return definePipeline({
    name: TWO_STEP_REQUIREMENT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: TWO_STEP_REQUIREMENT_AGGREGATE_TYPE }),
  })
    .withEvents([twoStepRequirementChangedEventSchema])
    .withCommand("recordTwoStepRequirementChanged", RecordTwoStepRequirementChangedCommand)
    .withProcessManager(TWO_STEP_REQUIREMENT_NOTICE_PROCESS_NAME, (pm) =>
      pm
        .state(twoStepRequirementNoticeStateSchema, TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE)
        .intent("notifyMembers", notifyMembersIntentSchema, runNotifyMembers(deps))
        .on(twoStepRequirementChangedEventSchema, onTwoStepRequirementChanged)
        .transient()
        .outbox({ leaseDurationMs: NOTICE_LEASE_MS, maxAttempts: NOTICE_MAX_ATTEMPTS }),
    );
}

export type TwoStepRequirementPipeline = ReturnType<
  ReturnType<typeof twoStepRequirementDefinition>["build"]
>;

/**
 * identity_two_step_requirement: the request records the change; the worker tells the members,
 * so a large organization never holds the request open (mfa-and-session-shape.feature).
 */
export function defineTwoStepRequirementPipeline(deps: {
  notices: TwoStepRequirementNotices;
}): TwoStepRequirementPipeline {
  return twoStepRequirementDefinition(deps).build();
}

export const twoStepRequirementEventing = defineEventingModule({
  pipeline: TWO_STEP_REQUIREMENT_PIPELINE_NAME,
  build: ({ app }: EventingSetup<IdentityRepositories, IdentityModule>) =>
    app.twoStepRequirementPipeline(),
  connect: ({ app, commands }) =>
    app.connectPipeline({ pipeline: TWO_STEP_REQUIREMENT_PIPELINE_NAME, commands }),
});
