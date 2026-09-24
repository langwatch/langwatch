/**
 * Identity's scheduled sweeps (ADR-123, ADR-117 §5): re-read every proved
 * domain's published evidence, and warn before a way back in ends. No events;
 * a global aggregate hosted by the worker, pruning against its own store.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { IdentityApp } from "../app/identity.app.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { runBreakGlassExpiryWarn } from "./break-glass-expiry-warn.intent.ts";
import {
  BREAK_GLASS_EXPIRY_WARN_INITIAL_STATE,
  BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS,
  BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
  type BreakGlassExpiryWarnState,
  breakGlassExpiryWarnSchema,
  breakGlassExpiryWarnWake,
} from "./break-glass-expiry-warn.process.ts";
import { runSsoDomainReproofSweep } from "./sso-domain-reproof-sweep.intent.ts";
import {
  SSO_DOMAIN_REPROOF_SWEEP_INITIAL_STATE,
  SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS,
  SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
  type SsoDomainReproofSweepState,
  ssoDomainReproofSweepSchema,
  ssoDomainReproofSweepWake,
} from "./sso-domain-reproof-sweep.process.ts";

export const IDENTITY_MAINTENANCE_PIPELINE_NAME = "identity_maintenance";

export const identityEventing = defineEventingModule({
  pipeline: IDENTITY_MAINTENANCE_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<IdentityRepositories, IdentityApp>) =>
    definePipeline({
      name: IDENTITY_MAINTENANCE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      .withProcessManager(BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME, (pm) =>
        pm
          .state<BreakGlassExpiryWarnState>(BREAK_GLASS_EXPIRY_WARN_INITIAL_STATE)
          .schedule({ everyMs: BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS })
          .onWake(breakGlassExpiryWarnWake)
          .intent(
            "warn",
            breakGlassExpiryWarnSchema,
            runBreakGlassExpiryWarn({
              warn: () => app.ssoBreakGlass().sweepWarnings(),
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            }),
          )
          // A warning is marked sent as it goes out; a retry would re-send.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 1 }),
      )
      .withProcessManager(SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME, (pm) =>
        pm
          .state<SsoDomainReproofSweepState>(SSO_DOMAIN_REPROOF_SWEEP_INITIAL_STATE)
          .schedule({ everyMs: SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS })
          .onWake(ssoDomainReproofSweepWake)
          .intent(
            "sweep",
            ssoDomainReproofSweepSchema,
            runSsoDomainReproofSweep({
              sweep: () => app.ssoDomainReproof().sweep(),
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            }),
          )
          // One batch of DNS and well-known reads; each lookup is bounded.
          .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
      )
      .build(),
});
