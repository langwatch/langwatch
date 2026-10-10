import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  runSignInLockReap,
  SIGN_IN_LOCK_REAP_INTERVAL_MS,
  SIGN_IN_LOCK_REAP_PROCESS_NAME,
  type SignInLockReapDeps,
  type SignInLockReapState,
  signInLockReapSchema,
  signInLockReapWake,
} from "./process-manager/signInLockReap.process";

export interface SignInLockMaintenancePipelineDeps {
  lockReap: SignInLockReapDeps;
}

/**
 * Credential maintenance for the sign-in lock-out counter (GAC-09), in its own
 * pipeline for the same reason the CLI login key sweep next door is in
 * hers: clearing away rows a failed sign-in left behind belongs to neither
 * the sign-in nor the queue.
 * Spec: specs/identity/org-account-lockout.feature.
 *
 * WHY THERE HAS TO BE A SWEEP AT ALL. The counter is keyed on the address
 * somebody TYPED, so that an address with no account behind it is counted and
 * locked exactly like one that resolves - which is what stops a lock-out from
 * being usable to discover who has an account here. The cost of that choice
 * is this pipeline: anybody can make rows appear by typing addresses at the
 * sign-in screen, and with no sweep the table keeps one row per address
 * anybody has ever got wrong, forever.
 *
 * It releases nothing. A row goes only once its lock has lifted AND it is not
 * held for review AND nothing has failed against it for a day, so a sweep that
 * has not run all week costs disk rather than protection - a lock is a date in
 * a row, not a timer in a process, and it survives every restart.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createSignInLockMaintenancePipeline(
  deps: SignInLockMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("sign_in_lock_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design - the rows it
      // clears are keyed by address and most of them belong to nobody.
      .withAggregateType("global")
      .withProcessManager(SIGN_IN_LOCK_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<SignInLockReapState>({ lastReapAt: null })
          .schedule({ everyMs: SIGN_IN_LOCK_REAP_INTERVAL_MS })
          .onWake(signInLockReapWake)
          .intent(
            "reap",
            signInLockReapSchema,
            runSignInLockReap(deps.lockReap),
          )
          // One bounded delete per tick. Nothing fans out, so the short lease
          // the other maintenance sweeps take is more than enough.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
