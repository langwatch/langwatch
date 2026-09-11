# Rebuild `@langwatch/api` around one path per transport

**Status:** plan, 2026-09-08. Replaces the "trim" brief. Follows the landed transport
declaration split (`packages/api/adrs/20260908-transport-declaration-split.md`) and the
annotation reference shape (ADR-133).

## What is wrong, measured

`packages/api/src`, tests excluded, on 2026-09-08:

| Measure | Value |
| --- | --- |
| Source files / lines | 79 / 14,903 (`rest/` 45 + `rest/security/` 5, `trpc/` 19) |
| Public exports | 269, of which 108 have no importer outside the package |
| Tests | 57 files, 13,081 lines, almost all of them testing the framework's own layering |
| Specs | 10 files, 147 scenarios |
| Files over 300 lines | 15; the five largest are 990, 982, 978, 782, 727 |

The size is not incidental. The package carries **three REST construction paths and two
tRPC ones**, and the reference path runs on top of the other two:

```
REST today                                  used by
──────────────────────────────────────────  ─────────────────────────────────────
A  createRestService fluent chain           2 process files (api-rest.security.ts,
   builder 990, pipeline 982, definition       api-secret-rest.feature.ts)
   727, types 499, versioning 315,
   route-mounting 452, public-rest-routing
   357, public-rest-input 163, capabilities
   198, sse 138, response 113, …  ≈ 5,000
B  SecuredApp / createAppRestSecurity       20 files in 9 features, raw Hono handlers
   security/rest-api-service 978,           (`AppRestSecurity` type: 211 importers)
   app-security 38
C  defineRestRouter  (transport 393)        annotation
   └─ mountProjectTransport (158)
        └─ family.service.registerTransportRoute   ← runs THROUGH A
             └─ family = security.createServiceVersionedApp  ← INSIDE B

tRPC today                                  used by
──────────────────────────────────────────  ─────────────────────────────────────
D  createTrpcService fluent chain (782)     105 files
   + createTrpcApiService per-feature       39 apps/api composition files
     policy decorators (297)
   + createPermissionProcedureBuilder (457)
   + createDeclaredAuthzMiddlewares (447)
   + createTrpcRuntimePolicy (459)
   + policy ports / context / lineage (303)
E  defineTrpcRouter (302)                   annotation
   └─ .router(service)  where service = createTrpcService(createTrpcApiService(…))
                                            ← runs THROUGH D, three builders deep
```

So a tRPC call on the reference path passes through a router builder, a service builder,
a policy-decorator factory, a permission builder and a middleware factory before it reaches
the one chain that does the work. Each layer has its own generics, its own tests and its
own spec scenarios, and the `apps/api` mount for annotation has to reconstruct a service
with a three-generic signature just to hand the declaration a runtime.

Machinery nobody uses, kept alive by tests and specs of its own:

| Machinery | Lines | Real use |
| --- | --- | --- |
| Rate limit + response cache ports (`RateLimiter`, `ResponseCache`, `capabilities.ts`) | ~250 + 21 spec scenarios | 1 `.withRateLimit()` call, 0 `.withCache()`, 0 importers of either port |
| SSE chain (`sse.ts`, `SseChain`, `registerSse`) | 138 + 7 scenarios | 0 users outside the package |
| Dated-version fallback, preview namespace, withdrawal (`versioning`, `route-mounting`, `public-rest-routing`) | 1,124 | 5 distinct dates in use, `withdraw` 7 sites, preview 0, header selection 2 files |
| Service defaults, groups, any-method routes, raw response | in `builder`/`definition`/`pipeline` | groups 4, any-method 4, `.withRawResponse` 163 (legacy families answering outside the contract) |

Feature knowledge inside the framework: `media-response.ts` (stored-object headers),
`personal-caller.ts` (personal-workspace keys), `rbac-vocabulary.ts` (roles),
`management-audit.ts` (audit rows), `broadcast.ts` (realtime), `platform-url.ts` (config),
`trpc-audit-redaction.ts` (model-provider secret fields), `trpc-audit.ts` (which
procedures are audit-exempt).

Access policy spread over two vocabularies for the same three decisions: `access-policy.ts`
(`requires`, `publicEndpoint`, `internalSecret`, `handlerManagedAuth`, `anyAuthenticated`,
`apiKeyPermission` for REST), `rest/security/*` (registry, declaration check, OpenAPI
security), and `trpc-permission-builder` + `trpc-declared-authz` + the five `appTrpc*Policy`
functions for tRPC. The vocabulary of *what a permission is* already lives in
`@langwatch/authz-contract` (4,379 lines) and *who is calling* in `@langwatch/actor`.

## The shape to reach

One declaration surface per transport, one runtime per transport, one access module both
runtimes call. Eleven source files, none the reader cannot hold.

```
packages/api/src/
├── index.ts               ApiHandlerArguments; ConnectUpgradeRouterPort (6 importers)
├── contract/
│   ├── index.ts
│   └── trpc-contract.ts   defineTrpcContract                          (exists, 152)
├── access/
│   ├── index.ts
│   └── access.ts          AccessDeclaration, Credential, decide()     (new, ~200)
├── trpc/
│   ├── index.ts
│   ├── trpc-router.ts     defineTrpcRouter                            (exists, 302)
│   └── trpc-runtime.ts    createTrpcRuntime(root, ports).mount(...)   (new, ~350)
└── rest/
    ├── index.ts
    ├── rest-router.ts     defineRestRouter                            (today transport.ts, 393)
    ├── rest-runtime.ts    createRestRuntime(ports).mount(...) → Hono  (new, ~400)
    ├── rest-openapi.ts    document(declarations)                      (new, ~200)
    └── rest-idempotency.ts Idempotency-Key ledger over a receipt port (today 3 files, 838 → ~350)
```

### The one execution path

Both runtimes run the same boxes in the same order. tRPC runs them as middlewares around
the contract's parser; REST runs them as one Hono handler per declared route.

```
request
  │
  ▼
trace ──▶ log ──▶ authenticate ──▶ parse ──▶ decide ──▶ handle ──▶ check output ──▶ audit ──▶ respond
              (ports.identity)  (contract   (access/   ({app,input,  (contract       (ports.
                                 schemas)    decide)     actor,scope,  output)        audit)
                                                         signal})
  any throw ───────────────────────────────────────────────────────────────────────────────▶ envelope
                                                        HandledError → its code, status, meta
                                                        Error        → 500 + trace id, reported
```

What a handler is handed never changes: `{ app, input, actor, scope, signal }`. No `ctx`,
no request, no response, no framework type.

### `access/` — the three decisions, once

```ts
type AccessDeclaration =
  | { kind: "permission"; permission: AuthzPermission }
  | { kind: "no-permission"; reason: string }
  | { kind: "service-authorized"; reason: string; permissions: readonly AuthzPermission[] };

type Credential = "session" | "projectKey" | "organizationKey" | "internalSecret" | "public";

// The one check. Both runtimes call it after parse, with the caller the process authenticated.
function decide(input: {
  declaration: AccessDeclaration;
  caller: Caller;              // from ports.identity.authenticate(request)
  input: unknown;              // parsed; the scope ids are read from it
  authorize: AuthorizePort;    // ports.authorization.forRequest(...)
}): Promise<{ actor: Actor | null; scope: AuthzDeclaredScopeId | null }>;

function securityRequirement(credential: Credential): OpenApiSecurityRequirement; // for rest-openapi
```

`decide` owns: the scope-lineage guard, the blank-scope-id refusal, the project-id
mismatch refusal, the fail-closed backstop ("a procedure that ran no check refuses").
Permission and declaration *types* come from `@langwatch/authz-contract`; nothing here
mirrors them. `defineTrpcRouter` and `defineRestRouter` both produce `AccessDeclaration`
from `.withPermission()` / `.noPermission()` / `.serviceAuthorized()`; REST additionally
names the `Credential` on the router (`defineRestRouter(Api).withNamespace("annotations")
.withVersion(v).withCredential("projectKey")`).

### Ports the process supplies

One object, five members, typed in the runtime that consumes them. `apps/api` implements
them once in its own composition; today's `api-rest.security.ts` (638 lines) and
`app-trpc.policy.ts` (130) already hold every piece.

```ts
type ApiRuntimePorts = {
  identity: { authenticate(request): Promise<Caller> };        // session, api key, org key, internal secret
  authorization: { forRequest(caller): AuthorizePort };        // getDecision, getProjectAnyDecision, checkScopeLineage
  audit: { record(entry): Promise<void>; redact(procedure, args): unknown };
  errors: { report(error): void; translate(cause): TranslatedCause | undefined };
  idempotency?: IdempotencyReceiptStore;                        // only if a REST route declares it
};
```

### What leaves the package

| Today | Goes to | Why |
| --- | --- | --- |
| `rest/media-response.ts` | stored-object server | knows stored-object headers |
| `rest/personal-caller.ts` | user server | knows personal-workspace keys |
| `rest/rbac-vocabulary.ts` | role feature | the roles catalogue |
| `rest/management-audit.ts`, `rest/broadcast.ts`, `rest/platform-url.ts` | the features that declare them, or `apps/api` | process ports a family declared through the framework for no reason |
| `trpc/trpc-audit-redaction.ts` | model-provider (list) + `ports.audit.redact` (hook) | the framework redacts, the owner says what |
| `trpc/trpc-audit.ts` exemptions | `ports.audit` | the process decides what it records |
| `errors.ts` envelope, `http-errors.ts`, `schemas.ts`, `base-responses.ts` (legacy flat envelope) | deleted with `SecuredApp` | the canonical envelope is `HandledError`; the flat one dies with the raw-Hono families |
| `schema.ts` (Standard Schema `ApiSchema`) | deleted | contracts are zod |
| `RateLimiter`, `ResponseCache`, `capabilities.ts` | deleted | 0 importers |
| `sse.ts` | deleted; a stream is a tRPC subscription | 0 users |

`bodyLimit` stays, as a router option (`.withBodyLimit(bytes)`): fifteen ingestion
families apply it and it is wire policy, not feature knowledge.

### Spec: four files, about forty scenarios

Each scenario names one thing a consumer can observe. Framework layering is not a scenario.

- `contract.feature` — a procedure is declared once in a browser-safe module; duplicate
  and unknown names refuse at compile time; the browser derives its client.
- `trpc.feature` — a declared procedure runs the one path; a procedure without an access
  decision has no `handle`; an undeclared output is diagnosed without leaking the response;
  a handled failure crosses as its code; an unhandled one as 500 + trace id; an audit row
  carries the redacted arguments; a stream carries plain JSON.
- `rest.feature` — a route is one complete declaration; params must match the path; a void
  answer is 204; the dated path and the bare path both answer; an unknown version is refused;
  a replayable create answers a retry from its receipt and refuses a different body under the
  same key; the body cap answers 413; the document carries every operation with its security.
- `access.feature` — the three decisions; a blank scope id is a wiring bug, not a wildcard;
  an input project id that disagrees with the credential's project is refused; a procedure
  that ran no check refuses; a service family cannot declare a check its credential cannot run.

`api-discovery.feature` and `openapi-route-coverage.feature` describe the discovery feature
in `apps/api`, not this package; they move there with their tests. The other eight are
deleted with the code they bind.

## Order of work

The consumers are the constraint: 105 files call `createTrpcService`, 20 call `SecuredApp`.
They convert feature by feature through the `feature-convert` skill, in the astra tree.
The package therefore rebuilds in three phases, and for the length of phase 2 **two
execution paths coexist**: the new runtime and the untouched legacy. Folding the legacy
builders over the new runtime first was considered and rejected: it is a rewrite of code
that is scheduled for deletion, and every fold is a chance to change a wire fact.
`feature-shape` and `all-apis-through-langwatch-api` count the legacy down.

```
Phase 0  root         freeze the wire: openapi-document.json + annotation integration tests are the oracle
Phase 1  api lane     build access/, trpc-runtime, rest-runtime, rest-openapi, rest-idempotency STANDALONE
                      re-point defineTrpcRouter/defineRestRouter at the runtimes; annotation moves onto them
                      delete transport-mount.ts; the legacy is not touched
Phase 2  feature lanes feature-convert, one feature at a time (astra tree); each removes its legacy importers
Phase 3  api lane     delete everything the table below names; four specs; README; ADR
```

### Phase 1 in detail (one Opus lane, `packages/api/**` + the annotation mount files)

1. **`access/access.ts`**: `AccessDeclaration`, `Credential`, `decide`, `securityRequirement`.
   Lift the checks out of `trpc-declared-authz.ts` (permission, permissionAny, no-permission,
   service-authorized, blank scope, lineage) and `access-policy.ts` (credential classes).
   Unit tests: one per decision, one per refusal.
2. **`trpc/trpc-runtime.ts`**: `createTrpcRuntime({ root, ports })` returning
   `{ mount(declaration, app) }`. Lift the middleware bodies from `trpc-runtime-policy.ts`
   (tracer, logger, handled-error, audit), `trpc-call-logging.ts`, `trpc-error-formatter.ts`,
   `trpc-failure-trace.ts`, `trpc-caller-trace.ts`; the output check from
   `trpc-service-builder.ts` (`validateDeclaredOutput`, `guardStream`). `mount` builds the
   procedure record directly on `root.procedure.input(member.input).use(chain).query|mutation|
   subscription(handler)`; no service builder in between. `defineTrpcRouter(...).build().router`
   takes the runtime, not a `TrpcService`.
3. **`rest/rest-runtime.ts`**: `createRestRuntime(ports)` returning `{ mount(declaration, app):
   Hono }`. One handler per route: body limit, authenticate, parse params/query/body with the
   declared schemas, `decide`, handler, output check, respond (204 on void), audit;
   `onError` renders `HandledError` as its envelope and everything else as 500 + trace id.
   Paths: `/api/<ns>/<version>/<path>` exact and `/api/<ns>/<path>` for the router's version.
   `rest-idempotency.ts` is called from inside the handler when the route declared
   `.withIdempotency()`. Lift, do not redesign: `pipeline.ts` already has each body.
4. **`rest/rest-openapi.ts`**: `document(declarations)` — operation id, path params, query,
   body, the declared output as the 200/204, the envelope as the error responses, security
   from `securityRequirement(credential)`. Keep `normalizeExclusiveBounds`. Compare the
   annotation operations byte-for-byte against `openapi-document.json` before and after.
5. **Annotation onto the runtimes**: `apps/api/src/features/annotation/annotation-trpc.mount.ts`
   becomes `runtime.mount(annotationTrpc, app)` for each namespace;
   `annotation-rest.mount.ts` becomes `restRuntime.mount(annotationRest, app)` plus its
   historical refusal bodies as the router's error handler. `transport-mount.ts` is deleted.
   The process wires `createTrpcRuntime`/`createRestRuntime` once in `api.application.ts`
   beside the legacy policy, from the same collaborators.
6. **Tests**: `trpc-runtime`, `rest-runtime`, `access` each get a unit file that drives the
   runtime with in-memory ports and the annotation contracts as fixtures; the
   `transport-declaration-split` tests move under them. Type tests stay for the compile-time
   refusals. Nothing in `rest/__tests__` or `trpc/__tests__` for the legacy is touched.

Exit: annotation contract/server/web suites green; `apps/api` annotation integration tests
green; `openapi-document.json` unchanged for annotation operations; `pnpm typecheck:one
packages/api` green; the consumer error-count guardrail below holds; `wc -l` of every new
file ≤ ~400 with the reason if over 300.

### Phase 3 deletion list (after the last consumer converts)

`rest/`: builder, pipeline, definition, types (all but `DateVersion`, `HttpMethod`),
versioning, route-mounting, public-rest-routing, public-rest-input, capabilities,
middleware, middleware-stack, response, response-types, sse, v1-alias, rest-version-selector,
validation, variables, scope-accessors, credential-principal, personal-caller, http-errors,
schemas, base-responses, hand-written-docs, family-error-handler,
canonical-family-error-handler, deprecation, management-audit, management-version
(`MANAGEMENT_API_VERSION` moves to the features' own version constants), broadcast,
rbac-vocabulary, platform-url, media-response, auth-diagnostics, trace-ids, app-security,
create-rest-router, `security/*`. `trpc/`: trpc-service-builder, trpc-api-service,
trpc-permission-builder, trpc-declared-authz, trpc-runtime-policy, trpc-policy-ports,
trpc-policy-context, trpc-scope-lineage, trpc-audit, trpc-audit-redaction, trpc-call-logging,
trpc-caller-trace, trpc-error-formatter, trpc-failure-trace, trpc-handler, trpc-root
(`initTRPC` is called by the process), create-trpc-router. Root: access-policy, errors,
schema, ports (all but the upgrade router), composition. Plus every test and spec of theirs,
and the README sections "Versioned HTTP services", "Compatibility registration methods",
"The definition chain", "Capabilities are ports", "SSE streaming", "Route mounting callback".

## Guardrails (every lane)

- **No git writes.** No `add`, `commit`, `stash`, `checkout`, `restore`, `reset`, `clean`.
- **No whole-tree checks.** Never root `pnpm typecheck`/`lint`/`format`/`test`, never
  `npx vitest`, never `pnpm dev`. Use `pnpm typecheck:one packages/api`,
  `pnpm --filter @langwatch/api test:unit`, `pnpm --filter @langwatch/annotation-server test:unit`,
  `pnpm --filter @langwatch/platform-api test:unit src/features/annotation`,
  `pnpm exec oxlint --config .oxlintrc.jsonc <files>`,
  `pnpm exec oxfmt --write --disable-nested-config <files>`.
- **Consumers keep compiling.** `pnpm typecheck:one apps/api` is red upstream; the substitute
  is `pnpm exec tsc -p apps/api/tsconfig.test.json --pretty false 2>&1 | grep -c "error TS"`
  before and after, and after must not exceed before.
- **Wire is frozen.** Paths, methods, status codes, headers, error codes, operation ids,
  OpenAPI output for every operation that exists today. `git diff --stat -- apps/api/src/features/discovery/openapi-document.json docs/api-reference/openapiLangWatch.json`
  must be empty at the end of phase 1.
- **Lift, do not redesign.** Every middleware body in the new runtimes is the body from the
  file it came from, with its tests moved. A behaviour change is a stop-and-report.
- **Style.** No re-exports, no `as unknown as`, no `try*`, no `{ ok, error }`, comments five
  lines or fewer and under 100 columns, `langwatch/logical-statement-spacing` clean
  (`oxlint --fix` then `oxfmt`), Edit/Write for changes, never sed over a file.
- **Delete, do not deprecate.** Nothing gets a `@deprecated` tag.
- **Stop and report** when a lift would change a wire fact, when the process ports need a
  collaborator `apps/api` does not have, or when a runtime cannot come under ~400 lines
  without dropping a box from the path.

## Self-review (phase 1 lane, before reporting)

1. `find packages/api/src -name '*.ts' -not -path '*__tests__*' | xargs wc -l` — every new
   file listed with its line count.
2. The four suites above green, with the counts.
3. Consumer error counts before/after, per project.
4. The OpenAPI diff command's empty output.
5. `grep -rn "annotation\|storedObject\|modelProvider\|personal" packages/api/src/access packages/api/src/trpc/trpc-runtime.ts packages/api/src/rest/rest-runtime.ts packages/api/src/rest/rest-openapi.ts` names no feature.
6. `grep -rn "createTrpcService\|SecuredApp\|registerTransportRoute\|createTrpcApiService" packages/api/src/trpc/trpc-router.ts packages/api/src/trpc/trpc-runtime.ts packages/api/src/rest/rest-router.ts packages/api/src/rest/rest-runtime.ts apps/api/src/features/annotation` is empty: the new path does not touch the legacy.
7. Read the diff as a reviewer: for each box in the path diagram, the function that
   implements it in each runtime and the test that drives it.

## Report format

```
## Outcome
## New files (path — lines — the box(es) of the path it holds)
## Lifted from (old file — new file — test moved)
## Annotation mounts (before lines → after lines)
## Suites (command — result)
## Consumer typecheck counts (project — before — after)
## OpenAPI diff (command — output)
## Left open (for phase 2 / 3, and anything stopped on)
```

## Decisions (Alex, 2026-09-08)

1. **Two paths during phase 2.** Confirmed. The legacy builders are not folded over the
   runtime; they are deleted in phase 3 when the last family converts.
2. **`MANAGEMENT_API_VERSION`** (77 importers): each management family names its own date,
   as annotation does; the constant dies in phase 3.
3. **`ConnectUpgradeRouterPort`**: stays in `@langwatch/api`.
4. **Dated version addresses are a product promise.** Every endpoint answers at its dated
   address, its `latest` address and its bare address; naming the version is optional for the
   caller. The runtime's version guards and dated fallback stay.
5. **Phase 1 landed** in `123bd57406` (runtime-composition repositories) and `3985d284a0`
   (runtimes, annotation, agent tRPC mounts). The organization door landed in
   `5080220f88`; the runtime's status and remaining gaps are section 5 of
   `dev/docs/plans/strict-feature-layout.md`.
