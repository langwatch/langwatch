# tRPC subscriptions on `apps/ui`'s transport

**Landed.** All nine of the browser's live procedures resolve on `apps/api`'s
own root and stream over `apps/ui`'s own transport. The lane that built the
client half is complete, and the five procedures it left blocked were unblocked
by composing their verticals in `apps/api` rather than by adding port groups to
a tree that was deletes-only.

## The wire, which is ours rather than tRPC's

Worth keeping, because it is why `@trpc/client`'s stock
`httpSubscriptionLink` cannot be used and the link had to be written:

```
GET  {origin}/api/sse/{procedure.path}?input={superjson.stringify(input)}
     Content-Type: text/event-stream; charset=utf-8
     Cache-Control: no-cache, no-transform
     X-Accel-Buffering: no

data: {superjson frame}          <- one frame, split across lines on \n
                                    and terminated by a blank line
: ping                           <- keep-alive comment every 25s
```

Connected / complete / error frames; the browser's own abort signal is threaded
into `createCaller` so an abandoned subscription's suspended `await` is
interrupted rather than leaked. `sseErrorFrame` keeps its ADR-045 shape: a
`HandledError`, directly or as a `TRPCError` cause, rides as
`{type:"error", message:<code>, error:<serialized>}`; everything else degrades
to the generic unknown.

The link now lives at `apps/ui/src/behavior/ui-sse-subscription-link.ts`
(moved out of `platform-api-client` by `268eb2ed83`), and the route declares
`handlerManagedAuth({ credential: "session", permissions: [] })` on the same
`ApiRestSecurity` every REST family declares on, so the one streaming route is
a registry entry rather than an unaccounted-for endpoint.

## The nine procedures, and where each is served

| Procedures                                                                         | Mounted by                               | Proof                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `export.onExportProgress`, `export.onScenarioRunExportProgress`                    | the product half                         | `api-trpc-collaborators.product.integration.test.ts`     |
| `presence.onPresenceUpdate`, `presence.onPresenceCursor`                           | `@langwatch/presence-server` on apps/api | its own mount                                            |
| `traces.onTraceUpdate`, `tracesV2.onDiscoverUpdate`                                | the observability half                   | `api-trpc-collaborators.trace-group.integration.test.ts` |
| `scenarios.onSimulationUpdate`, `langy.onConversationUpdate`, `langy.onTurnStream` | the agent half                           | `api-trpc-collaborators.agent-group.integration.test.ts` |

Two of the last three stream off the same tenant emitter the trace group reads
off the identity half, so a browser watching a simulation and a browser
watching a conversation listen to the object the worker's own fan-out writes
to.

## Three properties the agent group's suite pins that the others do not

- The tenant-wide Langy signal is **dropped** for a conversation the caller
  does not own (the user-scope gate, read off the broadcast payload rather than
  the input).
- `onTurnStream` passes its watch gate and then **completes cleanly** on a
  process with no Redis — the transport's documented answer. The browser falls
  back to the Postgres conversation read rather than seeing an error.
- The request's own abort signal rides the tRPC **context** as well as the
  caller's options, so a procedure resolved by a v10-shaped caller still learns
  the browser is gone instead of holding its emitter listener forever.

One lesson the lane recorded and nothing else states: a tRPC caller's namespace
is a **proxy**, and `typeof` a proxy over a function is `"function"`, so an
object-narrowed walk answers 404 for every live view.

## Nothing open

The `platform/app` twin this document once deferred to is deleted with the rest
of that tree. Moving a feature package onto the lane remains that family's own
work, and every family has since moved (`ui-family-move-manifests.md`).
