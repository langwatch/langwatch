import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  runSsoDomainReproofSweep,
  SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS,
  SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
  type SsoDomainReproofSweepDeps,
  type SsoDomainReproofSweepState,
  ssoDomainReproofSweepSchema,
  ssoDomainReproofSweepWake,
} from "./process-manager/ssoDomainReproofSweep.process";

export interface SsoDomainReproofMaintenancePipelineDeps {
  domainReproof: SsoDomainReproofSweepDeps;
}

/**
 * The sweep that re-reads the records proving domains (ADR-123 — see
 * specs/identity/sso-domain-verification.feature), in its own pipeline for
 * the same reason every other identity maintenance sweep is in theirs:
 * re-checking a domain's evidence belongs to neither the connection's own
 * write surface nor the queue.
 *
 * A missed tick costs a late waver, never a wrong one. The clock a domain
 * lapses on is written on the wavering fact and compared at the moment a
 * check runs, so a sweep that was down over a weekend produces a lapse on the
 * first tick after it comes back rather than a lapse that silently happened
 * while nobody was looking — and a resolver of ours that could not answer
 * produces nothing at all, which is the property the whole design rests on.
 *
 * UNDER THE OLD MECHANISM the first tick ran five minutes after boot rather
 * than at it, since the first tick makes outbound DNS lookups and ledger
 * writes a pod restarting in a crash loop should not be trusted with. A
 * scheduled process manager has no equivalent of an immediate first tick to
 * guard against in the first place: a freshly armed schedule's first wake
 * fires only a full interval (eight hours) after boot, which is already far
 * more conservative than the five minutes the old worker waited.
 *
 * SAFE TO RETRY, unlike its neighbour in this lane. Every fact this sweep can
 * emit comes from `SsoConnectionService`'s own guards
 * (`recordDomainProofPresent`/`recordDomainProofAbsent`), which are STATE
 * TRANSITIONS — the service's own comment calls this "a check that changes
 * nothing states nothing" (packages/identity-server/src/sso-domain-reproof.service.ts).
 * An outbox retry re-reads the same domains and, for every one already
 * accounted for, emits no fact and notifies nobody a second time — so the
 * larger `maxAttempts` the other maintenance pipelines use is safe here
 * without the break-glass sweep's caveat.
 *
 * Sized for DNS rather than for a database round trip: up to
 * `SSO_DOMAIN_REPROOF_BATCH` (500) domains are looked up one at a time with
 * no per-lookup timeout of our own, so a batch of unreachable nameservers can
 * run long. The lease is generous for the same reason blob-maintenance's is —
 * a large, lumpy batch rather than a handful of rows.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createSsoDomainReproofMaintenancePipeline(
  deps: SsoDomainReproofMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("sso_domain_reproof_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME, (pm) =>
        pm
          .state<SsoDomainReproofSweepState>({ lastSweepAt: null })
          .schedule({ everyMs: SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS })
          .onWake(ssoDomainReproofSweepWake)
          .intent(
            "sweep",
            ssoDomainReproofSweepSchema,
            runSsoDomainReproofSweep(deps.domainReproof),
          )
          // Up to 500 sequential DNS lookups with no lookup timeout of our
          // own; sized like blob-maintenance's large-batch lease rather than
          // the 5-minute default the lighter reaps use.
          .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
