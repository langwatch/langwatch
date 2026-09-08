# Grow the REST runtime: middleware facts, v1-only families, deprecation, public routes

**Date:** 2026-09-08 · **Owner lane:** one Opus agent in `packages/api` only, reviewed by Fable
**Why now:** the suite conversion stopped at its REST half (`packages/features/suite/server/src/transport/api-rest/`),
and the same three gaps block webhook, langy, coding-agent, auth, platform-health (`staticGeneration: "v1"`) and the
16 files that call `publicEndpoint`. `packages/api/specs/*.feature` is the oracle: every scenario below is
`@unimplemented` today and is retagged (`@unit` or `@integration`) and bound by a `@scenario` annotation when its
behaviour lands. Every gap: implementation, a unit test in the folded `__tests__/<file>.unit.test.ts`, the scenario.

1. **Declared middleware facts reach the handler.** `defineRestRouter(...).withMiddleware(fact)` stores
   `route.middleware` (`rest/runtime.ts` ~396–637) and `defineRestMiddleware`/`bindRestMiddleware`/`bindRestHeader`
   exist in `rest/request.ts` (~629–664) with no consumer: `handlerMiddleware` calls
   `route.handler({ app, input, actor, scope, signal })` with no facts. Design: a mount binds each declared fact once
   (`rest.mount(declaration, select, { facts: [bindRestHeader(surfaceHeader, "x-langwatch-surface"), bindRestMiddleware(projectSlug, ctx => ...)] })`),
   the runtime refuses at mount time a declaration whose fact has no binding (the failure names the fact and the
   route), and the handler receives `facts: { [fact.name]: parsed value }` typed from the declaration. Suite needs two
   facts on every route: the project slug (responses carry `platformUrl` built from slug + path) and the
   `X-LangWatch-Surface` header (a run started from the CLI records the `cli` actor; bound scenario in
   `packages/features/suite/specs/` "A run started from the command line records the cli actor"). Read
   `packages/features/suite/server/src/transport/api-rest/*.api.ts` and
   `packages/features/agent/server/src/transport/*.rest.ts` for the shapes the consumers want; read the agent one
   for what it already imports that does not exist (`projectRestFacts`, `mountProjectRestRouter`) and either provide
   those names or say in the report what the agent conversion must call instead. Scenario: `endpoint-capabilities`
   "An endpoint declares the headers every answer carries" plus a new scenario "A route's declared facts are bound
   once at the mount and reach every handler" in `packages/api/specs/transport-declaration-split.feature`.
2. **A family can be v1-only.** The legacy `staticGeneration: "v1"` published a family only under `/api/v1/<ns>`;
   `createRestRuntime` publishes `/api/<ns>`, `/api/<ns>/<version>`, `/api/<ns>/latest` and the `/api/v1` twins, and
   `dateFallback` answers any date ≥ the declared version. Add a declaration-level `addressing: "dated" | "v1-only"`
   (default `dated`); `v1-only` publishes exactly `/api/v1/<ns>/...` and nothing else (bare path 404, dated path 404,
   no `dateFallback`), the OpenAPI document lists only that address. Bound suite scenario "The run plans family
   answers only under /api/v1" (`run-plans-v1.api.integration.test.ts`) is the reference behaviour. Scenarios:
   `versioned-routing` "A family already under /api/v1 is mounted once" retagged, plus a new one "A v1-only family
   answers nowhere else".
3. **Deprecation and documented responses.** `withDeprecated({ successor, notice })` on a declaration (whole family)
   and per route: `Deprecation`, `Link`, `X-API-Deprecation-Notice` and `Warning: 299` headers on every answer
   including errors, `deprecated: true` in the document, and one log line per process per deprecated route the first
   time it is called (a `RestDeprecationLogPort` on the runtime ports, default no-op). Per-route `responses` docs
   (`documentedResponses({ 404: notFoundBody })`) emitted into the OpenAPI document. Fold the existing
   `deprecatedAlias` into this; keep its mount-option form working for the secret plural alias. Scenarios:
   `endpoint-capabilities` "Deprecation reaches the document and the wire" and "Deprecation headers ride errors too".
4. **Public routes.** `publicEndpoint` (legacy) let a route answer with no credential. Add a per-route
   `access: publicRoute({ reason })` in the access module that the REST runtime honours (no principal resolution, no
   scope, `actor: null`, rate-limit hook left as a fact), refused for any route whose declaration also names a scope
   input, documented as security-less in OpenAPI. Read the 16 callers (`grep -rl publicEndpoint packages/features
   apps/api/src`) for the shapes they need (platform-health, hosted-mcp, scim, ops, experiment, evaluation, trace) and
   list any that need more than "no credential". Scenarios: `public-rest` file — retag the ones this lands and say
   which stay `@unimplemented`.

Not in this lane: rate limit and response cache (their scenarios stay `@unimplemented`), `registerJsonProtocol`,
`assertEveryRouteDeclared` wiring.

Rules: Opus; Read/Edit/Write only; `packages/api/**` only (specs included); never root typecheck/lint/format;
allowed `pnpm typecheck:one packages/api`, `pnpm --filter @langwatch/api test:unit`, `npx oxlint <files>`,
`pnpm --filter @langwatch/architecture-lint check:feature-parity` (read the `packages/api/specs` lines). No git writes,
no baselines, no `.env*`, no re-exports, no `as unknown as`, no inline `import()`, comments ≤5 lines, `HandledError`
with a stable code for any knowable failure, no new file in `rest/` or `trpc/` beyond the nine (fold into the file that
owns the noun; `source-folder-shape` refuses a crowded folder or a fragment). Report: the four items one paragraph
each with the public names added and the test that pins each, how a mount declares facts / v1-only / deprecation /
public (the exact lines the suite REST conversion will write), exit outputs verbatim, scenarios retagged and the ones
left `@unimplemented` with the reason.
