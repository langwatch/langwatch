# ADR-002: Gateway realtime-session reconciliation worker boundary

**Status:** Accepted

The Gateway server package owns the realtime-session reconciliation loop. It
receives typed configuration plus session, credential, conversation-reader,
clock, and diagnostic ports; it does not read environment, Prisma, or
application state. Its `FeatureDefinition.worker` hook starts the timer only
when a worker runtime builds the feature, and `ResourceScope` owns shutdown.

Session booking and settlement still live in the legacy application service;
this batch moves the reconciliation policy and loop, not that wider write path.

The current application retains a thin adapter at
`platform/app/src/runtime/worker/gateway-realtime-session-reconciliation.adapter.ts` until the dedicated
worker app composes the contribution. `startWorkers` explicitly supplies its
Prisma client, realtime-session operations, credential reader, clock, config,
and logger; the adapter binds these plus SSRF-safe ElevenLabs reads without
adding reconciliation behaviour.
