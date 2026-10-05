---
name: api-transports
description: "Declare a REST route, a tRPC procedure or an SSE/subscription stream on a module: defineRestRouter, defineTrpcRouter, defineTrpcContract, .withInput/.withOutput/.withPermission/.withDocs, /api/<x> paths (/v1 optional), framework-owned validation (malformed_request 400 vs validation_error 422), throwing a HandledError, why a handler returns a plain value, invalidatedBy read hints and fromProjection cursor reads. Use when someone says 'add a route', 'add an endpoint', 'add a procedure', 'new tRPC query', 'REST handler', 'OpenAPI docs for a route', 'withDocs', 'validate the body', 'return a 404', 'streaming endpoint', 'subscription', 'read hint', 'why is my read stale', or opens a *.rest.ts / *.trpc.ts file."
user-invocable: true
---

# API transports: REST, tRPC, streams

Record: `dev/docs/ARCHITECTURE.md` section 8 (transports), section 12 (errors), the "Read hints" and
"Projection cursor reads" paragraphs of section 10.1. This skill teaches the shape and the traps and does
not restate rulings. Deleted spellings are section 15; target names are section 16.

A transport file **declares**. It never implements. The module's `*Api` operation holds the behaviour.

Writing the contract itself (`*Api`, schemas, error classes) is the `contract` skill. Not here: how the module gets installed, how stores and peers reach it, how `boot()` opens the hosts.
Those are the `process-composition` and `module-dependencies` skills. A module never mounts
anything; the process mounts every installed module's declarations.

## The rules that matter

1. **tRPC is declared twice, once per half.** The contract declares name, kind, input and output with
   `defineTrpcContract("<ns>")`. The process binds a permission and one handler with
   `defineTrpcRouter(<Name>Api, <ns>Trpc)`. The browser derives its client from the contract.
2. **REST is one complete endpoint per route** (`defineRestRouter(<Name>Api)`), with `.withInput` or
   `.withParams`/`.withQuery`, and `.withOutput` (or `.responds({ ... })` for several statuses).
3. **Output schemas are required.** A tRPC member with no `.withOutput` answers nothing and a handler
   that returns data is refused. A REST route declares `.withOutput` or `.responds` (mandatory, record section 8).
4. **A handler receives `{ input, app, actor, scope, signal }`, calls one `*Api` operation, returns a
   plain value or throws.** No `c.json`, no `JSON.parse`, no status branches, no error envelope, no
   `RestErrorHandler`. A handler that needs a branch moves into the module as an `*Api` operation.
5. **The framework owns validation.** Never hand-check a body, a content type or a param. Tighten the
   schema. Unparseable input is the 400 `malformed_request`; parsed but failing the schema is the 422
   `validation_error`. A REST request is authenticated before its body is read, so a bad key is 401/403,
   never 422 or 413.
6. **Every wire schema imports from the module's own contract.** No schema declared in the transport file.
7. **Docs live on the route.** `.withDocs({ tags, description, errors? })` in the same `*.rest.ts` file.
   Never a `*-openapi.rules.ts`. An extra status or non-JSON body goes through `documentedResponses()`.
8. **Paths are `/api/<x>`; `/api/v1/<x>` also answers.** Dated and `latest` versions exist but stay
   hidden (ADR `packages/api/adrs/004-public-rest-v1-and-date-negotiation.md`). A path parameter is named
   for what it identifies (`:triggerId`, never `:id`), except a route main already publishes.
9. **Auth is the process's.** REST authenticates with API keys, tRPC with the session. A route names a
   permission (`.withPermission("triggers:view")`), never a credential source. The caller arrives as
   `actor`/`scope`; no handler reads headers or looks the key's owner up.
   The door asks the permission before the handler runs. Never declare
   `.withAccess(anyAuthenticated(...))` and then ask a permission in a middleware fact, the handler or
   the `*Api`: that is a bypass. `{ at: "route", param }` asks at the scope the path names; on the
   `api_key` door `{ at: "grants" }` passes a key naming no project on any scope it is granted at, and
   `{ at: "organization" }` asks at the organization. If none fits, extend `packages/api` and the
   door (`modules/auth/process/src/services/api-door.service.ts`), with a spec scenario in
   `packages/api/specs/transport-declaration-split.feature`. A service keeps only the check that needs
   the loaded row.
   **Middleware never does the framework's work** (record §8, 2026-10-05): middleware that
   authenticates or parses a JSON body, and a route opened to any authenticated or unauthenticated
   caller, are drift that lint rules catch; the guard list is
   `dev/docs/plans/api-framework-bypass-2026-10-05.md`. The framework extensions E1 to E9 in that plan
   are shapes first: Alex approves the signature and one example route before any is built.
10. **A query never returns a credential.** Secrets come back only from a mutation.

## Worked example: one contract, one tRPC binding, one REST route

Contract (`modules/automation/contract/src/automation.trpc.ts`):

```ts
export const automationTrpc = defineTrpcContract("automation")
  .mutation("deleteById")
  .withInput(automationApiTriggerScopeSchema)
  .withOutput(automationDeletedSchema)

  .query("getTriggers")
  .withInput(automationApiProjectScopeSchema)
  .withOutput(automationListRowSchema.array());
```

Process (`modules/automation/process/src/transport/automation.trpc.ts`): permission plus one call.

```ts
defineTrpcRouter(AutomationApi, automationTrpc)
  .procedure("getTriggers")
  .withPermission("triggers:view")
  .handle(({ app, input }) => app.listAutomations({ projectId: input.projectId }));
```

REST (`.../transport/automation.rest.ts`): a namespace, a version, then complete routes.

```ts
defineRestRouter(AutomationApi)
  .withNamespace("triggers")
  .withVersion(MANAGEMENT_API_VERSION)
  .get("/:triggerId", "getApiTriggersById")
  .withParams(automationRestIdParamsSchema)
  .withPermission("triggers:view")
  .responds({ 200: automationRestResponseSchema, 404: badRequestSchema })
  .withDocs({ tags: ["Triggers"], description: "Get a trigger by its ID" })
  .handle(async ({ app, input, scope }) => ({
    status: 200 as const,
    body: wire(await app.getPublicTrigger({ triggerId: input.triggerId, projectId: scope.id })),
  }));
```

A POST that creates declares `.withInput(...)`, `.withStatus(201)` and `.withOutput(...)` in the same
way (`.post("/", "postApiTriggers")` in that file). A bodiless action declares an empty input schema from
its contract (`automationRestNoBodySchema`, record section 8).

## Refusing: throw a HandledError

Throw `HandledError` only when the cause is known and the caller can act on it. The class lives in
the module's contract (`modules/automation/contract/src/automation.errors.ts`: `TriggerNotFoundError`
carries `code: "trigger_not_found"` and `httpStatus: 404`). The service throws it; the transport lets it
escape. The REST runtime renders `type`, `code`, `message` at the root of the body, and tRPC sends the
code slug. Register the code in `packages/handled-error/src/app-codes.ts` and its customer copy in
`packages/handled-error/src/presentation.ts`. Never a `TRPCError`. Never set `Retry-After` yourself:
`meta.retryAfterMs` renders it. Everything unknown stays a plain `Error`; the boundary degrades it to
"unknown" plus a trace id. Detail: `dev/docs/best_practices/error-handling.md`.

## Streams and read hints

- A **stream** is a tRPC `.subscription(name)` in the contract; its `.withOutput` describes ONE yielded
  value. The process binds it like a procedure (`modules/presence/process/src/transport/presence.trpc.ts`,
  `onOrganizationReadHints`, which gets `signal` to stop). The API host serves it on `/api/sse/*`.
- A non-tRPC SSE route declares `.withResponse("sse", ...)` (covered by
  `packages/api/src/rest/__tests__/response-kind.integration.test.ts`). A protocol that must write the
  raw response itself is a declared raw HTTP door (record section 8), never a handler hack.
- **Reads answer in full.** The server never answers `unchanged` and never sends an ETag or a 304.
  The browser caches and decides when to refetch.
- **Say when a read goes stale** on its contract, not in the screen:
  `.query("getScopeGraph", { invalidatedBy: ["lw.project.created"] })`, or with a scope field
  `{ event, scope: "organizationId" }`. The framework hints on each committed event; the browser refetches.
  Hints carry no data. No timer polling.
- **Projection-backed reads** declare `{ fromProjection: ["<projection>"] }` instead (never both). The
  cursor is the event id; see `eventing-and-worker` and the "Projection cursor reads" paragraph.
- Every read is mirrored to the browser's disk by default (§10); there is no opt-in and `cache: { persist }`
  is a deleted spelling (§15). High-traffic reads go on `UI_QUERY_MIRROR_EXCLUDED`
  (`@langwatch/browser-host/cache-tiers`). `revision: n` is bumped only when a read's meaning changes
  and its shape does not.
- Specs: `packages/api/specs/read-hints.feature`, `packages/eventing/specs/projection-cursor-reads.feature`.

## Traps

| Trap                                                 | Instead                                                |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `c.json(...)`, `try/catch` into a status             | return the value; throw a HandledError                 |
| checking `typeof body.x` in a handler                | tighten the Zod schema in the contract                 |
| `:id` on a new route                                 | `:<thing>Id`                                           |
| a docs object in `*-openapi.rules.ts` (deleted, §15) | `.withDocs()` on the route                             |
| a handler calling two `*Api` operations              | one operation that carries both                        |
| a new procedure name chosen casually                 | the wire name is the browser's cache key; choose once  |
| a secret in a query output                           | a mutation returns it once; forms read blank           |
| a raw `/api/cron/*` route                            | a scheduled process manager (`eventing-and-worker`)    |
| REST route for the UI                                | the UI uses tRPC; REST is key-authenticated public API |

## Tests

Mount the real router on a real runtime and assert status, body and `code`:
`modules/automation/process/src/transport/__tests__/automation.rest.integration.test.ts` and
`automation.trpc.unit.test.ts`. See the `testing` skill. A changed route, name, status or permission is a
wire change: diff the served surface against `origin/main` and record every difference.
