// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly send: an hourly plan over the enrolled cohort and one outbox intent per member.
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
import { RequestDigestSendCommand } from "./digest-send.commands.ts";
import {
  DIGEST_SEND_AGGREGATE_TYPE,
  DIGEST_SEND_PIPELINE_NAME,
  DigestSendRequestedEventSchema,
} from "./digest-send.events.ts";
import {
  DIGEST_MEMBER_SEND_INITIAL_STATE,
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

/** A plan asks one send per member: a few calls each, well inside the lease. */
const PLAN_LEASE_MS = 10 * 60 * 1000;
/** One member's send reads the week's folds and mails the picked template once. */
const SEND_LEASE_MS = 2 * 60 * 1000;
const SEND_MAX_ATTEMPTS = 5;
const SENDS_AT_ONCE = 4;

/** What the two intents carry out; late-bound to the services the module composes. */
export interface DigestSendRunner {
  planWeek(input: PlanWeekIntent): Promise<void>;
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
    .withEvents([DigestSendRequestedEventSchema])
    .withCommand("requestSend", RequestDigestSendCommand)
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
