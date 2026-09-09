# Grow the REST runtime, round three: bytes in, bytes out, methods, shared-prefix families, the last doors

**Date:** 2026-09-09 · **Owner lane:** one Opus agent in `packages/api` only, reviewed by Fable
**Follows:** round two (`0bbce5b9c0`: `anyAuthenticated`, route-scoped permissions, `v1-in-path`, `dated { v1Twin: false }`,
`internalSecret`, `responds`, `scimToken`). `packages/api/specs/*.feature` is the oracle; each item lands with its unit test
in the folded `__tests__/<file>` and a retagged or new scenario bound by `@scenario`. No new file under `rest/` or `trpc/`
(the ten-file split is DECISION D-o in `strict-feature-layout.md` section 9; fold new code into the file that owns the
noun and report where the split should cut).

Three parts, run as three lanes in this order, one at a time, since they share `runtime.ts`.

## Part A: bytes and methods (LANDED; hash in `strict-feature-layout.md` section 5)

1. **Raw request bytes.** `scim-webhook-intake.api.ts` computes an HMAC over the exact characters; github and elevenlabs
   webhooks (gateway) verify signatures the same way. Add `.withRawBody("text" | "bytes")` on a route: the body limit still
   runs first, the validators do not, the handler receives `raw` (string or `Uint8Array`) beside `input`, and the document
   publishes the media type the route names. Refused together with `withInput`.
2. **Raw responses.** `/api/files` (stored-object; `Content-Type` from the row, `Content-Length`, a stream), image-proxy,
   rum, `gateway-internal.api.ts` (9 routes) and the SCIM intake write their own bodies. Add `.withRawResponse({ produces })`:
   the handler returns `{ status, headers, body: ReadableStream | Uint8Array | string }`, `respond()` writes it verbatim,
   the document lists `produces` with no schema, `responds`/`withOutput` are refused beside it.
3. **A HEAD twin and any-method routes.** `/api/files` answers `HEAD` by draining the stream with no body; trace's OTLP alias,
   experiment v3 and the BetterAuth handshake pass every method to one handler. Add `.methods(["GET", "HEAD"])` (a HEAD
   twin writes headers only) and `.anyMethod()` (registry records it, document lists the methods it names). Both refused
   on a route with `withInput` body schemas for methods that carry no body.
4. **The 405 guard.** A path the family serves with another method answers 405 with an `Allow` header, not 404 (automation
   asks for it; `versioned-routing.feature` has the scenario). Apply it per family at mount.
5. **A union output.** stored-object's `createUpload` answers `existing | pending`. `withOutput` accepts `ZodObject | ZodArray |
   ZodVoid | ZodUndefined`; widen it to a discriminated union whose members are objects, and publish `oneOf` with the
   discriminator.

## Part B: doors and addressing (LANDED `3f7db75a6b`)

Notes from Part A for item 8: `mountMethodGuards` registers `app.all(<address>)` per family, which is safe while every family
owns `/api/<namespace>` but would answer 405 ahead of a sibling's route for a literal-path family sharing a prefix, so a
literal family installs guards only on the exact paths it declares, never wildcarded. Item 12 also blocks stored-object's
id-only `/api/files/:id`. Item 10 should reuse the `RouteState` record and the `assertSourceUnset` family rather than a
parallel mechanism.

6. **An optional credential.** ops bug-report answers with or without a key: `.withAccess(optionalCredential({ reason }))`,
   handler gets `caller | null`, registry records it, the document publishes the scheme as optional.
7. **The instance-admin key as a door.** `instance_admin_api_key` has a class and a scheme and no door; it creates the first
   organization, so its scope is `null` like `internalSecret`. `withCredential("instanceAdminKey")`.
8. **A shared-prefix family.** evaluation's legacy family (`/api/evaluations/list`, `/api/evaluations/batch/log_results`,
   `/api/evaluations/:evaluator/evaluate`, `/api/evaluations/:evaluator/:subpath/evaluate`, `/api/guardrails/:evaluator/evaluate`,
   `/api/dataset/evaluate`) is bare-mounted with a `/api/v1` twin, no dated namespace and no version guard, and every
   released SDK calls the bare paths. That is `versioned-routing.feature`'s "A family at a shared prefix mounts its own
   paths and their canonical address": an addressing that takes literal paths (`.withAddressing("literal", { paths })` or
   equivalent) and publishes exactly them plus the twin.
9. **A generation other than v1 in the path.** `scim-protocol.api.ts` lives at `/api/scim/v2`; `v1-in-path` hard-codes `v1`.
   Generalise to `{ generation: "v2" }`.
10. **Rate limit and response cache.** `withRateLimit` and `withCache` had two callers (stored-object's public family, one
    more); a declaration states the policy, the mount supplies the store as a port.
11. **`registerJsonProtocol` (1 caller) and `assertEveryRouteDeclared` wired** so a process refuses to serve a family the
    registry never saw.
12. **In-handler owner resolution.** `/api/files/:id` (id-only, kept for historical message content) resolves the owning
    project inside the handler after a cross-tenant ClickHouse lookup, and the runtime demands a project scope before the
    handler runs. Decide the shape: `anyAuthenticated` plus an app-side check, or a door variant that defers the scope.

13. **Multipart bodies.** dataset's `POST /api/dataset/upload`, `POST /api/dataset/:slugOrId/upload` and
    `POST /api/dataset/direct-upload` take files. A declaration states a JSON body or none; add a multipart input kind with
    field schemas and the file parts named, documented as `multipart/form-data`.
14. **A browser-session door.** dataset's direct-upload routes (`direct-upload`, `staging/:uploadId`, `:datasetId/finalize`,
    `retry`, `DELETE`) and the deleted dataset generator authenticate a session cookie inside the handler. Add
    `withCredential("session")` resolving the person and their project scope through the identity port.
15. **Two success statuses on one route.** `PATCH /api/dataset/:slugOrId/records/:recordId` answers 201 when it created and
    200 when it replaced; `responds` allows exactly one 2xx. Allow two when both carry the same schema.
16. **A streamed answer.** `POST /api/dataset/generate` streamed a UI-message response; its rules are kept in
    `packages/features/dataset/server/src/rules/dataset-generate-tools.rules.ts`. Item 2's raw response covers the body;
    what is missing is the session door (14).

## Part C: tRPC — LANDED `913e0feaec` (09-09 15:1x)

Public names: `.withAccess(publicRoute({ reason }))` on a procedure (runs on the runtime's `anonymousProcedure`, no
Actor, identity port never consulted, refused if the contract input names a scope field); `browserSessionFact` and
`callerAddressFact` declared with `.withFacts(...)`, bound at the mount with `bindTrpcHeader` / `bindTrpcFact`, values
reach the handler after its arguments in declaration order; `.withPermission([a, b])` is AND, one `permission_denied`
naming the permission it stopped on. `trpc/runtime.ts` is 1,609 lines; the declaration half (~300 lines) is the cut
when it passes 1,800.

### Wiring still owed (the consumer lines, one lane)

- `packages/features/monitor/server/src/transport/monitor.trpc.ts:19-31`: `.serviceAuthorized({... permissions: ["evaluations:view", "analytics:view"] ...})` → `.withPermission(["evaluations:view", "analytics:view"])`; `MonitorApp.performanceForProject`'s second check goes.
- `packages/features/authz/contract/src/declared-middleware.ts:28-43`: `AuthzDeclaration` gains `{ kind: "permission-all"; permissions; via? }` and `{ kind: "public"; reason }`.
- `apps/api/src/app-trpc/__tests__/authz-declaration-sweep.unit.test.ts:160-177`: `coveredScopeFields` gains `case "permission-all"` (flatMap `forPermission`) and `case "public"` (`[]`).
- `apps/api/src/app-trpc/app-trpc.policy.ts:122-126`: `createTrpcRuntime({ ..., anonymousProcedure: root.procedure })`, and fact bindings at the mounts that declare them.
- `packages/features/user/server/src/transport/api-trpc/user.api.ts` (`register` on `publicRoute` + `callerAddressFact`, `otherSessionsToRevoke` on `browserSessionFact`) lands with the user module's conversion off `createTrpcService`.

Original item 13 text follows.

13. An anonymous procedure kind (`register`), the browser session's row id on the Actor or as a fact
    (`otherSessionsToRevoke`), the caller's address as a fact (register throttle), and an AND-composed permission
    (`monitors.getPerformanceForProject` needs `evaluations:view` and `analytics:view` together; today it is
    `serviceAuthorized` with the app checking both).

Rules: Opus; Read/Edit/Write only, read before delete; `packages/api/**` only (specs included); never root
typecheck/lint/format; allowed `pnpm typecheck:one packages/api`, `pnpm --filter @langwatch/api test:unit`, `npx oxlint
<files>` (counts on `runtime.ts`/`access.ts` must not grow past HEAD's), `pnpm --filter @langwatch/architecture-lint
check:feature-parity` (`packages/api/specs` lines). No git writes, no baselines, no `.env*`, no re-exports, no `as
unknown as`, no `try*`, no inline `import()`, comments ≤5 lines, `HandledError` codes for knowable failures.
Report: each item one paragraph with public names and the pinning test; the exact consumer lines (stored-object `/api/files`,
image-proxy, rum, gateway-internal, scim intake, trace OTLP alias, experiment v3, auth, automation); exit outputs
verbatim; scenarios retagged / added / left; what is still open for parts B and C.

## Part E - LANDED a8e843e6ba (09-09)

- `RestTransportDocs.requestBody` publishes a raw-body route's request schema (io input, 3.1 spelling); a route
  declaring both `withInput` and `docs.requestBody` publishes its body twice, no refusal yet (cheap assert beside
  `assertParsedBodyFree` when wanted).
- `TARGET_KIND_BY_ROUTER` names nine more kinds (`model_provider` for the Codex row, snake_case like the table);
  two-segment prefix looked up before the root. Older namespaces (annotation, dataset, dashboard, topic, suite,
  share) still unnamed.
- Body and multipart declaration types moved to `rest/request.ts`, docs type to `rest/openapi.ts`;
  `declaration.ts` 1,820 -> 1,764. Under 1,500 needs the body-shaped asserts (~130 lines) and the builder's
  source-declaring half to move too.
