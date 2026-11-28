// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly send: an hourly plan over every organization and one outbox intent per member and organization.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DigestModule } from "../app/digest.app.ts";
import type { DigestRepositories } from "../repositories/digest.repositories.ts";
import {
  RequestDigestOrganizationPlanCommand,
  RequestDigestSendCommand,
} from "./digest-send.commands.ts";
import {
  DIGEST_SEND_AGGREGATE_TYPE,
  DIGEST_SEND_PIPELINE_NAME,
  DigestOrganizationPlanRequestedEventSchema,
  DigestSendRequestedEventSchema,
} from "./digest-send.events.ts";
import {
  DIGEST_MEMBER_SEND_INITIAL_STATE,
  DIGEST_ORGANIZATION_PLAN_INITIAL_STATE,
  DIGEST_ORGANIZATION_PLAN_PROCESS_NAME,
  digestOrganizationPlanRequested,
  digestOrganizationPlanStateSchema,
  type PlanOrganizationIntent,
  planOrganizationIntentSchema,
  DIGEST_MEMBER_SEND_PROCESS_NAME,
  DIGEST_PLAN_INITIAL_STATE,
  DIGEST_PLAN_INTERVAL_MS,
  DIGEST_PLAN_PROCESS_NAME,
  digestMemberSendStateSchema,
  digestPlanStateSchema,
  digestPlanWake,
  digestSendRequested,
  type PlanWeekIntent,
  planWeekIntentSchema,
  type SendDigestIntent,
  sendDigestIntentSchema,
} from "./digest-send.process.ts";

/** The week's plan only pages organization ids and asks one plan each: well inside the lease. */
const PLAN_LEASE_MS = 10 * 60 * 1000;
/** One organization's plan reads its roster and asks one send per member. */
const ORGANIZATION_PLAN_LEASE_MS = 10 * 60 * 1000;
const ORGANIZATION_PLAN_MAX_ATTEMPTS = 5;
const ORGANIZATION_PLANS_AT_ONCE = 2;
/**
 * One person's send for one organization: up to three analytics reads per visible project (the
 * week's totals, its model breakdown, the week before's traces), each through the 8-slot limiter
 * the concurrent sends share, then one mail. Analytics bounds a read at 45s (the tenant gate's
 * wait in `analytics.app.ts`), so a send among SENDS_AT_ONCE (4) with P projects each waits at
 * worst 4 x 3 x P reads / 8 slots x 45s = 67.5s x P: 10 minutes covers P = 8 with every read at
 * its bound, and reads that take a second cover hundreds of projects. The 30-minute cache means
 * the members of one organization mostly share those reads.
 */
const SEND_LEASE_MS = 10 * 60 * 1000;
const SEND_MAX_ATTEMPTS = 5;
const SENDS_AT_ONCE = 4;

/** What the two intents carry out; late-bound to the services the module composes. */
export interface DigestSendRunner {
  planWeek(input: PlanWeekIntent): Promise<void>;
  planOrganization(input: PlanOrganizationIntent): Promise<void>;
  sendDigest(input: SendDigestIntent): Promise<void>;
}

/** The week folds' retention, which the hourly plan runs first; owned by the week service. */
export interface DigestWeekSweeper {
  sweep(input: Pick<PlanWeekIntent, "at">): Promise<void>;
}

function digestSend(deps: { runner: DigestSendRunner; weeks: DigestWeekSweeper }) {
  return definePipeline({
    name: DIGEST_SEND_PIPELINE_NAME,
    aggregate: defineAggregate({ type: DIGEST_SEND_AGGREGATE_TYPE }),
  })
    .withEvents([DigestSendRequestedEventSchema, DigestOrganizationPlanRequestedEventSchema])
    .withCommand("requestSend", RequestDigestSendCommand)
    .withCommand("requestOrganizationPlan", RequestDigestOrganizationPlanCommand)
    .withProcessManager(DIGEST_PLAN_PROCESS_NAME, (pm) =>
      pm
        .state(digestPlanStateSchema, DIGEST_PLAN_INITIAL_STATE)
        .schedule({ everyMs: DIGEST_PLAN_INTERVAL_MS })
        .onWake(digestPlanWake)
        // Its dispatched rows are reaped by the platform's process retention sweep.
        .intent("planWeek", planWeekIntentSchema, async (plan) => {
          await deps.weeks.sweep(plan);
          await deps.runner.planWeek(plan);
        })
        .outbox({ leaseDurationMs: PLAN_LEASE_MS, concurrency: 1, batchSize: 1, maxAttempts: 3 }),
    )
    .withProcessManager(DIGEST_ORGANIZATION_PLAN_PROCESS_NAME, (pm) =>
      pm
        .state(digestOrganizationPlanStateSchema, DIGEST_ORGANIZATION_PLAN_INITIAL_STATE)
        .intent("planOrganization", planOrganizationIntentSchema, (plan) =>
          deps.runner.planOrganization(plan),
        )
        .on(DigestOrganizationPlanRequestedEventSchema, digestOrganizationPlanRequested)
        .outbox({
          leaseDurationMs: ORGANIZATION_PLAN_LEASE_MS,
          maxAttempts: ORGANIZATION_PLAN_MAX_ATTEMPTS,
          concurrency: ORGANIZATION_PLANS_AT_ONCE,
          batchSize: ORGANIZATION_PLANS_AT_ONCE,
        }),
    )
    .withProcessManager(DIGEST_MEMBER_SEND_PROCESS_NAME, (pm) =>
      pm
        .state(digestMemberSendStateSchema, DIGEST_MEMBER_SEND_INITIAL_STATE)
        .intent("sendDigest", sendDigestIntentSchema, (send) => deps.runner.sendDigest(send))
        .on(DigestSendRequestedEventSchema, digestSendRequested)
        .outbox({
          leaseDurationMs: SEND_LEASE_MS,
          maxAttempts: SEND_MAX_ATTEMPTS,
          concurrency: SENDS_AT_ONCE,
          batchSize: SENDS_AT_ONCE,
        }),
    );
}

export type DigestSendPipeline = ReturnType<ReturnType<typeof digestSend>["build"]>;

export function buildDigestSendPipeline(
  deps: Parameters<typeof digestSend>[0],
): DigestSendPipeline {
  return digestSend(deps).build();
}

export const digestSendEventing = defineEventingModule({
  pipeline: DIGEST_SEND_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DigestRepositories, DigestModule>) => app.sendPipeline(),
  connect: ({ app, commands }) => app.connectSendCommands(commands),
});
