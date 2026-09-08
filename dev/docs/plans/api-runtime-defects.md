# Four defects in the new REST runtime, found by the secret conversion

**Date:** 2026-09-08 · **Owner lane:** one Opus agent in `packages/api` only, reviewed by Fable

Each item: fix, a unit test in the folded `__tests__` file that pins it, and a bound scenario in
`packages/api/specs/` (an existing `@unimplemented` scenario retagged where one already says it).

1. **Body limit runs after the body is consumed.** In `packages/api/src/rest/runtime.ts` the route
   stack pushes the body-limit middleware after the validators and the input middleware, which have
   already read the request body, so `drainWithinCap` throws `Invalid state: ReadableStream is locked`
   and every POST or PUT on a route with `withBodyLimit` answers 500. Order the limiter ahead of the
   validators. Test: a route with a 1 KiB cap and a validated body accepts a 512-byte body and refuses
   a 2 KiB one with 413, never 500. Then restore the 16 KiB cap the secret family declared
   (`packages/features/secret/server/src/transport/secret.rest.ts`, and put back the "Requests have
   16 KiB inputs" clause the lane removed from the description) — that one file outside `packages/api`
   is allowed for this item, and agent-call.rest.ts already uses `withBodyLimit`.
2. **Scope mismatch answers 500.** `assertInputScope` in `packages/api/src/access/access.ts` refuses
   an input `projectId` that disagrees with the credential's project by throwing a plain `Error`. Throw
   the handled error the old family answered with (403, code `scope_input_mismatch`; find its class in
   `packages/api/src/errors.ts` or the response module and export it if it is not). Test: a mismatch
   answers 403 with that code and leaks nothing about the other project.
3. **OpenAPI tags are dropped.** `restRouteDocumentation` in `rest/openapi.ts` emits `summary`,
   `description`, `operationId` and `responses`; `RestTransportDocs` has no `tags`. Add `tags` to the
   docs type and emit it. Test: a route declaring `tags: ["Secrets"]` appears with that tag in the
   generated document.
4. **Collection routes get a trailing slash.** `addressesOf` concatenates `/<version>` with a route
   path that is already `"/"`, producing `/api/secret/latest/`, which then falls through to `/:id`.
   A route path of `"/"` contributes nothing to the address. Test: a collection route's dated, latest
   and v1 addresses have no trailing slash, and a request to the collection reaches the collection
   handler, not the by-id one.

Also: the deprecated `/api/secrets` alias used to answer `Deprecation`, `Warning` and
`X-API-Deprecation-Notice` headers and log once. `rest/openapi.ts` carries `deprecatedAlias`; check
it produces those three headers and say in the report how a mount declares it, so the secret plural
family can be marked deprecated in the wave-2 wiring.

Rules: Opus; Read/Edit/Write only; `packages/api/**` plus the one secret transport file named in item 1;
never root typecheck/lint/format; allowed `pnpm typecheck:one packages/api`, `pnpm --filter
@langwatch/api test:unit`, `npx oxlint <files>`, `pnpm --filter @langwatch/architecture-lint
check:feature-parity` (read the `packages/api/specs` lines). No git writes, no baselines, no `.env*`,
no re-exports, no `as unknown as`, no inline `import()`. Report: the four fixes one paragraph each with
the test that pins each, exit outputs verbatim, the deprecation answer.
