/**
 * Auth's scheduled sweep (specs/identity/org-account-lockout.feature): clear
 * the lock-out rows that have settled. No events; a global aggregate hosted
 * by the worker, pruning against its own store.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";

import type { AuthApp } from "../app/auth.app.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import { SignInLockReapService } from "../services/sign-in-lock-reap.service.ts";
import { SIGN_IN_LOCK_REAP_PROCESS_NAME, runSignInLockReap } from "./sign-in-lock-reap.intent.ts";
import {
  SIGN_IN_LOCK_REAP_INITIAL_STATE,
  SIGN_IN_LOCK_REAP_INTERVAL_MS,
  type SignInLockReapState,
  signInLockReapSchema,
  signInLockReapWake,
} from "./sign-in-lock-reap.process.ts";

export const SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME = "sign_in_lock_maintenance";

/** The pipeline itself, over only what it reads, so a test can build it without an app. */
export function buildSignInLockMaintenance({
  repositories,
  processStore,
}: EventingSetup<Pick<AuthRepositories, "signInLocks">, unknown>): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SIGN_IN_LOCK_REAP_PROCESS_NAME, (pm) =>
      pm
        .state<SignInLockReapState>(SIGN_IN_LOCK_REAP_INITIAL_STATE)
        .schedule({ everyMs: SIGN_IN_LOCK_REAP_INTERVAL_MS })
        .onWake(signInLockReapWake)
        .intent(
          "reap",
          signInLockReapSchema,
          runSignInLockReap({
            reap: () => SignInLockReapService.create({ locks: repositories.signInLocks }).reap(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One idempotent delete; a retry removes nothing twice.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}

export const authEventing = defineEventingModule({
  pipeline: SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME,
  build: (setup: EventingSetup<AuthRepositories, AuthApp>) => buildSignInLockMaintenance(setup),
});
