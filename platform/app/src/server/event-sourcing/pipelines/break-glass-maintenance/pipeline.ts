import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS,
  BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
  type BreakGlassExpiryWarnDeps,
  type BreakGlassExpiryWarnState,
  breakGlassExpiryWarnSchema,
  breakGlassExpiryWarnWake,
  runBreakGlassExpiryWarn,
} from "./process-manager/breakGlassExpiryWarn.process";

export interface BreakGlassMaintenancePipelineDeps {
  expiryWarn: BreakGlassExpiryWarnDeps;
}

/**
 * The sweep that says a way back in is ending (D05 — see
 * specs/identity/sso-onboarding-tiers.feature), in its own pipeline for the
 * same reason every other identity maintenance sweep is in theirs: warning
 * that a binding is ending belongs to neither the binding's own write surface
 * nor the queue.
 *
 * It never expires anything. A binding stops being a way in because
 * `breakGlassIsLive` compares two numbers at the moment somebody asks, not
 * because a job ran — so an installation whose sweep was down over a weekend
 * still has an expiry that happened on the date it said it would. This
 * pipeline exists purely so nobody is surprised by that date, which is why a
 * missed tick costs a late warning rather than an access decision nobody
 * made.
 *
 * UNDER THE OLD MECHANISM the first tick ran a minute after boot rather than
 * at it, specifically so a pod restarting in a crash loop would not re-send
 * whatever it had not yet recorded as sent. A scheduled process manager has
 * no equivalent of an immediate first tick to guard against in the first
 * place: a freshly armed schedule's first wake fires only a full interval (an
 * hour) after boot, which is already far more conservative than the minute
 * the old worker waited. The manual PostHog capture the old worker did on
 * failure is dropped for the same reason every other migrated sweep drops
 * it: the outbox keeps its own attempt log and dead-letters a message that
 * exhausts `maxAttempts`, so a failing sweep is already visible without a
 * second reporting path.
 *
 * `maxAttempts: 1` IS DELIBERATE, unlike the template's usual 3.
 * `SsoBreakGlassService.sweepWarnings` (packages/identity-server/src/break-glass.service.ts)
 * sends a binding's warning and only THEN records it as sent
 * (`notifier.warn` followed by `bindings.recordWarningsSent`, per binding, in
 * the same call) — so a failure landing between those two steps leaves a
 * warned binding looking un-warned, and a fast outbox retry would re-run the
 * whole sweep and re-send that binding's warning. Failing forward to the next
 * scheduled wake (an hour away, same as the old worker's failure behavior)
 * instead of retrying within the same cycle avoids compounding that gap. See
 * the migration report for what this means today (the wired notifier only
 * logs) versus once a real notifier sends mail.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createBreakGlassMaintenancePipeline(
  deps: BreakGlassMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("break_glass_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME, (pm) =>
        pm
          .state<BreakGlassExpiryWarnState>({ lastWarnAt: null })
          .schedule({ everyMs: BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS })
          .onWake(breakGlassExpiryWarnWake)
          .intent(
            "warn",
            breakGlassExpiryWarnSchema,
            runBreakGlassExpiryWarn(deps.expiryWarn),
          )
          // A single bounded read (limit 200) plus at most that many
          // notifier calls — lighter than the DNS-bound reproof sweep next
          // door, so the default-ish lease holds. `maxAttempts` is 1: see
          // above.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 1 }),
      )
      .build()
  );
}
