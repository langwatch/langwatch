# ADR-130: The API router type is declared, not inferred from the application

**Date:** 2026-09-06

**Status:** Proposed

## Context

`AppRouter` is the type of the router the API process mounts. A browser package names it to get typed procedures — the names on the wire, the input each takes, the output each answers. That is the whole contract a client needs.

It has never cost only that. `apps/api/src/app-trpc/app-trpc.types.ts` is two lines:

```ts
import type { ApiApplication } from "../api.application";
export type AppRouter = ApiApplication["trpc"];
```

`ApiApplication.trpc` carries no annotation. It is inferred from `this.root.router({ agents, secrets, ...this.buildFeatureRouters() })`, over `AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures>`, which is built from `ComposedApiFeatures` — a record whose every member came from a `*.composition.ts` module. So answering "what is `AppRouter`" meant loading, binding and checking every feature composition, every transport mount and every feature server package the API process owns.

`import type` does not protect against this, and that is the part people get wrong. The compiler still loads the named module and still follows that module's own **value** imports. Thirty-seven type-only imports of thirty-seven composed-feature records dragged thirty-seven value graphs behind them, and through those the AWS S3, CloudWatch Logs and Lambda clients, Stripe, kysely, openai, better-auth and — the single largest — an ElevenLabs speech SDK, 2,606 declaration files reached from `@langwatch/scenario`.

Priced in isolation, on 2026-09-06, with a scratch project whose entire content is

```ts
import type { AppRouter } from ".../apps/api/src/app-trpc/app-trpc.types";
export type X = AppRouter;
```

that one import loaded **11,583 files and allocated 4.59 GB** — 97.5% of what checking the whole of `apps/api` costs. Stubbing `AppRouter` to `AnyTRPCRouter` took `apps/ui` from 19,320 files / 7.83 GB of heap to 10,126 files / 4.00 GB. Half of the browser application's typecheck was the API application, arriving through one type import.

Two things make this expensive here rather than merely untidy. Every workspace package resolves to **source**, not to built declarations, so a first-party dependency is parsed, bound and checked again inside every consuming project — a type seam is the only thing standing between a consumer and the whole graph. And the router type is instantiated in one uncached go at each consumer rather than incrementally beside the code that builds it, which is why the isolated probe reported *more* instantiations than `apps/api` itself does.

```
  BEFORE                                   the whole application, to name a type

  AppRouter
    └─ api.application.ts ────────────── hono, fetch adapter, agent + secret servers
         └─ app-trpc.features.ts
              └─ app-trpc.composed.ts
                   ├─ 37 × *.composition.ts ── adapters, repositories, Prisma,
                   │                            @aws-sdk/client-s3, aws-client,
                   │                            eventing/server, prompt-server, …
                   └─ 37 × *-trpc.mount.ts ─── 37 feature SERVER barrels
                                                 └─ @langwatch/scenario
                                                      └─ @elevenlabs/elevenlabs-js
                                                           (2,606 files)
```

## Decision

We will make `AppRouter` a **declared** type over the feature contracts, so naming it costs the wire contract and nothing else.

The machinery already exists and is already trusted. `packages/platform-api-client/src/feature-api.ts` turns a plain `FeatureApiMap` — a nested map of `{ query | mutation | subscription: { input, output } }`, with no `@trpc/server` types in it at all — into a router type through `RouterFromMap<TMap>`. Thirty-eight feature web packages already write one and build their hooks from it. The end state is:

- each feature's procedure map moves from its `web` package to its **contract** package, where both halves can name it;
- `apps/api` declares `AppApiMap` as the record of those maps, and `AppRouter` is `RouterFromMap<AppApiMap>`;
- `ApiApplication.trpc` is annotated with that declared type, and each `create*TrpcRouter` factory declares its own return type from its feature's map, so no consumer re-infers a router;
- one test in `apps/api` — where the application's graph is already paid for once — asserts the built router and the declared map agree in both directions, so the declaration cannot drift from what the process actually mounts.

```
  AFTER                                    the wire contract, and nothing else

  AppRouter = RouterFromMap<AppApiMap>
    └─ AppApiMap ── 38 × <feature>/contract  (plain nested {input, output} maps)

  apps/api only:  built router  ⟷  RouterFromMap<AppApiMap>   (conformance test)
```

This lands in stages, and the first stage is done:

**Stage 1 — separate the record from the composition (landed).** Every `Composed*Feature` type moved out of its `*.composition.ts` into a type-only sibling `*.composition.types.ts` that imports only the feature's application class and its router factory, and `app-trpc.composed.ts` and the other type-only importers were repointed. Two supporting moves were needed: `ApiTraceReadStackPort` is now its own module (`features/trace/trace-read-stack.port.ts`) because the trace record names it, and `analyticsRouters` is now `features/analytics/analytics-trpc.routers.ts` because the analytics record names its return type.

Measured on the same probe, before and after, cold and uncapped:

| probe: one `import type { AppRouter }` | Files | Symbols | Types | Instantiations | Memory used |
| --- | ---: | ---: | ---: | ---: | ---: |
| before stage 1 | 11,583 | 8,074,894 | 3,760,147 | 14,630,697 | 4.59 GB |
| after stage 1 | 11,292 | 7,575,835 | 3,510,447 | 13,300,931 | 4.25 GB |
| **saved** | **−291 (−2.5%)** | **−499k (−6.2%)** | **−250k (−6.6%)** | **−1.33M (−9.1%)** | **−0.34 GB (−7.4%)** |

Wall-clock is not quoted: the machine was between load 20 and load 64 throughout, and ADR-100 already records that timings under that are contention. `Files`, `Symbols`, `Types`, `Instantiations` and `Memory used` are load-independent.

**Stage 1b — the browser stops naming the type at all (landed).** Stage 2 is what makes `AppRouter` cheap for everyone. It is not what the browser application was waiting for: only two first-party modules in `apps/ui`'s program named the type, and neither needed a router type that the machinery in `feature-api.ts` could not already give it.

`packages/features/secret/web` was the only package importing `@langwatch/platform-api-client`'s root barrel, whose one export was `trpcReact = createTRPCReact<AppRouter>()`. It now declares `SecretApiMap` and calls `createFeatureApi<SecretApiMap>()`, exactly as its thirty-seven siblings do — four procedures, whose inputs and outputs are the secret contract's own schemas. `app-router-client.ts` and the barrel it was the only member of are deleted; the package's remaining three subpath exports (`./feature-api`, `./query-key`, `./invalidate`) are what every other package already imported, and it no longer depends on `@langwatch/platform-api`.

`apps/ui/src/behavior/ui-feature-transport.ts` exported `createUiAppApiClient`, a `TRPCClient<AppRouter>` over the same three links `createUiFeatureApiClient` builds. Nothing in the application called it; one unit test did. It is deleted with its test, and `apps/ui` no longer depends on `@langwatch/platform-api` in any form. The addressing behaviour that test also covered — a query reaching `/api/trpc/<procedure>` — is asserted on the surviving client by `apps/ui/tests/ui-feature-transport.unit.test.ts`.

Measured on `apps/ui` itself, cold and uncapped, one run at a time:

| `apps/ui` | Files | Lines | Identifiers | Symbols | Types | Instantiations | Memory used | Check time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before stage 1b | 19,011 | 2,569,715 | 3,085,366 | 11,420,847 | 4,807,123 | 19,583,709 | 7.63 GB | 294.1 s |
| after stage 1b | 10,101 | 1,314,208 | 1,532,599 | 5,534,379 | 1,824,181 | 8,015,665 | 4.05 GB | 18.4 s |
| **saved** | **−8,910 (−47%)** | **−49%** | **−50%** | **−5.89M (−52%)** | **−2.98M (−62%)** | **−11.57M (−59%)** | **−3.58 GB (−47%)** | **−94%** |

`tsc --listFiles` on the browser project now reports **0** files under `apps/api/src` and **0** under `@elevenlabs/elevenlabs-js`, down from 118 and 2,606. This lands almost exactly on the `AnyTRPCRouter`-stub bound measured before stage 1 (10,126 files / 4.00 GB) — because the browser now names no router type at all, rather than a cheap one. Check time is quoted here despite ADR-100 only because the change is a factor of sixteen; the file and memory counts are the evidence.

Stage 2 is still the fix. It is now the fix for `apps/api`'s own consumers and for anything that names `AppRouter` in future, not for the browser.

**Stages 2-4 — declare the type.** Move the maps to the contracts, declare `AppApiMap`, annotate `ApiApplication.trpc`, give the factories return types, add the conformance test.

## Rationale / Trade-offs

Stage 1 was expected to be "the cheap 80%". It is not, and the measurement is the reason to write this down rather than to keep going by feel. It removed what a composition opens *beyond* what its record names — adapters, repositories, `@aws-sdk/client-s3`, `@langwatch/eventing/server`, `@langwatch/prompt-server` and the rest — and that is 7% of the heap. Everything else stayed, because the record still names `ReturnType<typeof create*TrpcRouter>`, that factory still lives in a mount module, and the mount still imports its feature's server barrel. `app-trpc.features.ts` imports the same mounts directly in any case, so the mounts were never removable by moving a type.

After stage 1 the remaining graph is still 11,292 files, of which 3,746 are workspace source and the rest arrive through those: `@elevenlabs/elevenlabs-js` 2,606, `@smithy/core` 518, `stripe` 261, `kysely` 251, `@openrouter/sdk` 245, three `@aws-sdk` clients 419 between them. None of it is reachable from a declared map, which is why stage 2 is the fix and stage 1 is only the ground it stands on.

Explicit return types on the router factories (the fourth item above) were considered as an independent change and are not one. `createApiKeyTrpcRouter` returns `ApiKeyTrpcApi.create(...)`, whose own `static create` (`packages/features/api-key/server/src/transport/api-trpc/api-key.api.ts:176`) is generic over context, options and root types and declares no return type either; the type is built by a `createTrpcService(...).query(...).build()` chain. There is no return type to write by hand short of the procedure record itself — which is what the contract map is. Annotating the factories is therefore downstream of stage 2, not a warm-up for it.

Annotating `ApiApplication.trpc` alone was also considered and rejected as a stopping point. It would replace an inference with an assignability check, which is worth having, but the annotation still has to *name* the record, so the graph does not shrink by a file.

The cost of the decision is a second place the wire contract is written: the map in the contract package, and the handler in the server package. The conformance test is what keeps them one contract rather than two — and the same split already exists, unguarded, in the thirty-eight web packages that hand-write a map today.

## Consequences

`AppRouter` gains a ceiling it cannot quietly exceed. `packages/architecture-lint/tests/app-router-type-seam.unit.test.ts` walks the real import graph from `app-trpc.types.ts` — following type-only imports, because the compiler does — and fails if the reachable workspace source count passes 3,850 (3,746 today), or if any feature that has a `*.composition.types.ts` sibling is reached through its composition again. `specs/setup/app-router-type-seam.feature` carries both scenarios.

Both of the consumers that used to pay are gone (stage 1b), so no browser package names `AppRouter` any more. A third scenario on the same spec — "The browser program compiles no API application source" — walks every module `apps/ui/src` loads, following type-only imports as well as value ones, and fails with the list of `apps/api/src` files a change pulled back in. It was confirmed to bite: a scratch module in `apps/ui/src` importing `AppRouter` fails it with 118 files named.

`@langwatch/scenario` re-exporting ElevenLabs conversation types from its package root no longer reaches the browser. It is still worth fixing upstream, because nothing first-party names `@elevenlabs/elevenlabs-js` anywhere in this repository.

## References

- ADR-099: TypeScript 7 is the compiler
- ADR-100: the check queue's memory clamp — why wall-clock under load is not evidence
- `specs/setup/app-router-type-seam.feature`
- `packages/platform-api-client/src/feature-api.ts` — `FeatureApiMap`, `RouterFromMap`
