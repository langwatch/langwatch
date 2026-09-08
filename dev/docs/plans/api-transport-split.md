# Transport declaration split: `@langwatch/api` and annotation

**Status:** brief for one Opus lane, 2026-09-08. Spec:
`packages/api/specs/transport-declaration-split.feature`. Shape reference:
`packages/features/annotation`. Shared decision: ADR-133
(`dev/docs/adr/133-composition-spec.md`).

## What this changes, in one picture

```
today                                                 after
─────                                                 ─────
contract/src/annotation-trpc.schemas.ts   (input)     contract/src/annotation.trpc.ts
contract/src/annotation.schemas.ts        (output)      defineTrpcContract("annotation")
                                                          .query("getById").withInput(S).withOutput(O)
server/src/transport/annotation.trpc.ts                   .mutation("deleteById").withInput(S)
  defineTransport(AnnotationApi).withRouter(r =>           .build()
    r.query("getById", p => p.withInput(S)
      .withOutput(O).withPermission(P)               server/src/transport/annotation.trpc.ts
      .handle(h)))                                     defineTrpcRouter(AnnotationApi, annotationTrpc)
                                                          .procedure("getById").withPermission(P).handle(h)
web/src/behavior/annotation-api.ts                        .procedure("deleteById").withPermission(P).handle(h)
  type AnnotationApiMap = { annotation: {                  .build()
    getById: { query: { input; output } } … } }
  createFeatureApi<AnnotationApiMap>()                 web/src/behavior/annotation-api.ts
                                                          createFeatureApi<typeof annotationTrpc>()   (derived, no map)

server/src/transport/annotation.rest.ts                server/src/transport/annotation.rest.ts
  defineTransport(AnnotationApi).withVersion(V)          defineRestRouter(AnnotationApi)
    .withRouter(r => r.get("/:id","getAnnotation")         .withNamespace("annotations").withVersion("v1")
      .withParams(S).withPermission(P).withOutput(O)       .get("/:id", "getAnnotation").withParams(S)
      .withDocs(D).handle(h))                                .withPermission(P).withOutput(O).withDocs(D).handle(h)
                                                           .build()

apps/api/src/features/annotation/annotation-trpc.mount.ts  the mount binds the framework's request context;
  carries TContext / TOptions / TRoot generics              the feature files name none of them
```

The server repeats nothing the contract said: `.procedure(name)` selects a declared
member and inherits its kind, input and output. The browser derives its client from the
contract's type. REST stays one complete endpoint per route because it has no browser
half to share a declaration with.

## Why

- `packages/api` is ~13,000 lines over 77 implementation files with overlapping
  construction paths: `createRestService`/`ServiceBuilder`/`GroupRegistrar`
  (`src/rest/builder.ts`), the `security/rest-api-service.ts` layer, and `defineTransport`
  whose mount (`src/rest/transport-mount.ts`) translates back into `registerTransportRoute`.
- The tRPC chain (`src/trpc/trpc-service-builder.ts`) supports raw `{ ctx, input }`
  handlers and governed app handlers with different output behaviour (ADR-006).
- Framework files know feature names: `src/trpc/trpc-audit-redaction.ts` lists specific
  procedures, `src/rest/media-response.ts` knows stored-object policy.
- Every feature declaration today drags the process's `TContext`, `TOptions`, `TRoot`
  through its types (`TrpcTransportRouter<Api>` in `src/trpc/transport.ts`), which is why
  `annotation-trpc.mount.ts` is 60 lines of generics.
- The web api-map (`web/src/behavior/annotation-api.ts`, 281 lines) is a second,
  hand-maintained description of what the server already declared, and its comment says
  so.

## Current facts to build on (verified 2026-09-08)

| Fact                                                                                          | Where                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@langwatch/api` exports `.`, `./rest`, `./trpc`, `./composition`; there is no `./contract`  | `packages/api/package.json` `exports`                                 |
| tRPC `defineTransport(api).withRouter(define).build()` returns `{ protocol, api, router }`    | `packages/api/src/trpc/transport.ts`                                  |
| REST `defineTransport(api).withVersion().withRouter(...)` builds `RestTransportRoute[]`       | `packages/api/src/rest/transport.ts` (`RouteBuilder`, `RestTransportRouter`) |
| REST mount: `mountProjectTransport({ family, transport, app, credential, authenticate, authorize, afterSuccess })` | `packages/api/src/rest/transport-mount.ts`                  |
| tRPC mount: `createTrpcHandlerBinding` → `createTrpcApiService` → `createTrpcService` → `transport.router(service)` | `apps/api/src/features/annotation/annotation-trpc.mount.ts`, `packages/api/src/composition.ts` |
| Handler arguments type `ApiHandlerArguments<Input, App>` = `{ input, app, actor, scope, signal }` | `packages/api/src/handler-arguments.ts`                           |
| Access declarations: `withPermission(AuthzPermission \| AuthzDeclaration)`, `noPermission({ reason })`, `serviceAuthorized({ reason, permissions, enforces })`; the process maps each kind in `apps/api/src/app-trpc/app-trpc.declared-check.ts` | `packages/api/src/trpc/trpc-permission-builder.ts`, `trpc-declared-authz.ts` |
| Output check wraps the handler, never `.output()`, so client types stay the handler's own (ADR-006) | `packages/api/src/trpc/trpc-service-builder.ts`                |
| Browser: `createFeatureApi<Map>()` returns `CreateTRPCReact<RouterFromMap<Map>>`; `WireOf`, `OutputsFromMap` | `packages/platform-api-client/src/feature-api.ts`         |
| annotation tRPC namespaces `annotation` (18 procedures) and `annotationScore` (6)              | `server/src/transport/annotation.trpc.ts`, `annotation-score.trpc.ts` |
| annotation REST family answers under `/api/annotations` with `MANAGEMENT_API_VERSION`          | `server/src/transport/annotation.rest.ts`                              |
| Only annotation uses `defineTransport` (3 files); 434 files import `@langwatch/api/rest` or `/trpc` | grep                                                              |
| Type tests exist and run under `pnpm --filter @langwatch/api typecheck` (`tsconfig.type-tests.json`, `type-tests/*.ts`) | `packages/api/type-tests/`                        |
| Feature specs: `packages/api/specs/*.feature`, bound by `@scenario` annotations             | `packages/api/specs/trpc-framework.feature`, `fluent-registration.feature` |

## Scope

**In:**

1. `packages/api`: a new `./contract` entry (`src/contract/index.ts`) exporting
   `defineTrpcContract`; `defineTrpcRouter` on `./trpc`; `defineRestRouter` on `./rest`;
   one execution path each, built from the enforcement functions that already exist
   (authenticate, parse, authorize exact target, handler, output check, serialize; tracing
   and the error boundary around the whole). A dated ADR
   `packages/api/adrs/20260908-transport-declaration-split.md` and a README section.
2. `packages/platform-api-client`: derive the React Query client from a contract type
   (`createFeatureApi<typeof contract>()` or a sibling with a name that says what it takes),
   keeping `WireOf`/`OutputsFromMap` working over it.
3. `packages/features/annotation`: `contract/src/annotation.trpc.ts` and
   `annotation-score.trpc.ts` (the declarations), the two server tRPC files and the REST
   file rewritten onto the new builders with the **same wire names, schemas, permissions
   and paths**, the web `behavior/annotation-api.ts` and `annotation-scores-api.ts` reduced
   to the derived client (the hand-written map types go), `annotation.server.ts`
   `.withTransports(...)` updated, tests re-pointed.
4. `apps/api/src/features/annotation/`: the tRPC and REST mounts updated to the new
   declarations, with the framework owning the request context; `app-trpc.features.ts`
   keeps the same two namespace keys.
5. Binding every scenario in `packages/api/specs/transport-declaration-split.feature`
   (remove `@unimplemented` as you bind) and `type-tests/` for the compile-time refusals.

**Out (do not touch):** any other feature package, any other `apps/api/src/features/*`,
`apps/worker`, `apps/ui` beyond what the derived client forces (it should force nothing:
`uiApiBinding` receives the same object shape), the legacy builders other features still
use (`createRestService`, `ServiceBuilder`, raw-context handlers, `handlerManagedAuth`,
`withCustomPermission`). Mark those deprecated in the README with the sentence "removed
when the last feature converts" and nothing more. Do not move audit redaction or media
policy out of the framework in this change; list them in the ADR's "leaves the core
next" section. No new dependencies. No baseline edits.

## Order of work

1. **Read** ADR-133, `packages/api/adrs/006-trpc-fluent-chain.md`,
   `20260828-trpc-framework-boundary.md`, `001-rpc-first-fluent-registration.md`, the three
   annotation transport files, the two mounts, `feature-api.ts`, and the spec file above.
   Write nothing yet.
2. **Prototype in the type tests first.** `packages/api/type-tests/transport-declaration-split.ts`
   with one contract, two tRPC procedures, two REST endpoints, and the refusals as
   `// @ts-expect-error` lines: unknown procedure name, duplicate implementation, missing
   implementation at `build()`, `handle` before an access decision, data returned from a
   void procedure, params schema not matching the path. Get `pnpm --filter @langwatch/api typecheck`
   green with those lines in place. If a refusal cannot be expressed at compile time, it
   becomes a runtime throw in `build()` with a unit test, and the ADR says which and why.
3. **Implement** `defineTrpcContract`, `defineTrpcRouter`, `defineRestRouter` and their
   mounts, reusing the existing pipeline pieces rather than a parallel copy. The
   declaration types carry no process generics; the mount side (`createTrpcHandlerBinding`
   and its REST twin) is where `TContext` lives.
4. **Convert annotation**, one namespace at a time, tests green between each:
   `annotationScore` (6 procedures), then `annotation` (18), then REST. Keep a table of
   wire name → permission → input schema → output schema before you start and diff it
   after: nothing in that table may change.
5. **Derive the web client** and delete the map types. `WireOf<Annotation>` and friends
   keep working; every `annotationApi.<ns>.<proc>.useQuery` call site compiles unchanged.
6. **Bind the spec**, update the README and write the ADR.
7. **Self-review** (below), then report.

## Guardrails

Hard rules for this lane. Each has a reason; none has an exception.

- **No git.** No `git add`, `commit`, `stash`, `checkout`, `restore`, `clean`, `reset`.
  Other lanes are editing this tree; the root session commits by pathspec.
- **No whole-tree checks.** Never `pnpm typecheck`, `pnpm typecheck:all`, `pnpm lint`,
  `pnpm format`, `pnpm test` at the root, never `npx vitest`, never a hand-rolled vitest
  config, never `pnpm dev`. Use `pnpm typecheck:one <package>`,
  `pnpm --filter <package> test:unit <path>`, `pnpm exec oxlint --config .oxlintrc.architecture.json <files>`,
  `pnpm exec oxfmt --write --disable-nested-config <files>`.
- **Same wire, same policy.** Every procedure name, namespace key, REST path, operation
  id, permission and schema annotation has today survives byte-identical. A cache key in
  the browser is `["annotation","getById"]`; a renamed segment silently stops sharing a
  cache with four other call sites.
- **Contract stays browser-safe.** `contract/src/annotation.trpc.ts` and
  `@langwatch/api/contract` value-import only `zod` and the schemas; tRPC and Hono may be
  named in `import type` only. `pnpm --filter @langwatch/architecture-lint test:unit tests/frontend-boundary.unit.test.ts`
  must stay green, and `feature-source-layout` allows the `trpc` qualifier in a contract
  only if the file exports no server artifact (check with oxlint on the file).
- **Handlers are closed.** `{ input, app, actor, scope, signal }` and trailing parsed
  middleware facts. No `ctx`, headers, request, response, `c.json`, `process.env`. The
  `api-transport-*` architecture-lint rules already refuse most of this; do not add
  exceptions to them.
- **Expected failures throw `HandledError`.** No `{ ok, error }` results, no `try*`
  methods, no new error code without `app-codes.ts` + `presentation.ts` entries.
- **Output check is a diagnostic, not redaction.** A mismatch logs procedure name, issue
  path and request metadata, never the response body, and the caller gets the handler's
  answer.
- **No re-exports, no compatibility aliases, no `as unknown as`, no inline `import()`.**
  Comments are five lines or fewer and describe what the code does.
- **Delete what you replace inside annotation.** The map types, the old declaration
  files and any helper only they used go; an unused export is a finding, not a courtesy.
- **Specs first, tags on, `@scenario` bound.** An untagged scenario enforces nothing;
  `@unimplemented` stays only on scenarios you did not bind, and the report lists them.
- **Stop and report** (do not work around) if: a compile-time refusal needs a change to
  `apps/ui`; a wire name would have to change; the derived client cannot type a procedure
  annotation has today; `feature-source-layout` refuses `annotation.trpc.ts` in the
  contract. Each is a design decision for the root session, not for the lane.

## Self-review mechanism

Run this against your own diff before reporting. It is a second pass by a hostile
reviewer, and its output is the evidence table in the report; an item without a command
and its output is unreviewed.

1. **Refusals compile-fail.** In `type-tests/transport-declaration-split.ts`, temporarily
   delete one `// @ts-expect-error` and confirm `pnpm --filter @langwatch/api typecheck`
   fails on that line; restore. Do it for all six refusals. A refusal that does not fail
   when its expect-error is removed is not a refusal.
2. **Wire table diff.** Print the before/after table (namespace, procedure, kind,
   permission, input schema name, output schema name; REST: method, path, operation,
   permission, schemas) and show `diff` is empty.
3. **Generics leak.** `grep -rn "TContext\|TRoot\|TOptions\|TrpcApiMount\|AnyTRPCRootTypes" packages/features/annotation` prints nothing.
4. **AppRouter and maps.** `grep -rn "AppRouter\|ApiMap = {" packages/features/annotation/web/src` prints nothing.
5. **Contract purity.** `grep -n "^import " packages/features/annotation/contract/src/annotation.trpc.ts packages/api/src/contract/*.ts | grep -v "import type" | grep -v "zod\|\./"` prints nothing.
6. **Sabotage the path.** Remove `.withPermission` from one converted procedure: the
   package must fail to typecheck. Return `{ data: … }` from a void REST route: same.
   Restore both.
7. **Tests run, not parse.** `pnpm --filter @langwatch/api test:unit`,
   `pnpm --filter @langwatch/annotation-contract test`, `pnpm --filter @langwatch/annotation-server test`,
   `pnpm --filter @langwatch/annotation-web test`,
   `pnpm --filter @langwatch/platform-api test:unit src/features/annotation`. Paste the
   `Tests` summary lines.
8. **Typecheck the packages you touched**, one by one:
   `pnpm typecheck:one packages/api`, `packages/platform-api-client`,
   `packages/features/annotation/contract`, `/server`, `/web`, `apps/api`.
9. **Parity.** `pnpm --filter @langwatch/architecture-lint check:feature-parity 2>&1 | grep -A8 "transport-declaration-split"`;
   read the `THIS RUN FAILS` banner, not a per-file tick.
10. **Read your diff as the reviewer.** For each file: why does it change, which
    scenario or guardrail makes it necessary, what would break if it were reverted. A file
    with no answer is reverted.
11. **Re-read ADR-133's six requirements** and state, per requirement, the line of your
    change that satisfies it or why it is out of scope.

## Report format

```
## Outcome
one paragraph: what works end to end, what does not

## Wire table
before/after diff (empty) or the rows that changed and why the root must decide

## Files
path — why (one line each), grouped: packages/api, platform-api-client, annotation contract/server/web, apps/api

## Refusals
| refusal | compile-time or runtime | test that proves it | expect-error removal failed? |

## Self-review evidence
| item 1-11 | command | result |

## Left open
scenarios still @unimplemented and why; "leaves the core next" items; anything that needs the root session
```
