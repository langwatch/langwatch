# Delete the legacy transport and fold `@langwatch/api` into a dozen files

**Date:** 2026-09-08 · **Ruling:** Alex, "just delete legacy" and "how are there this many files in
rest/trpc folders, it's unacceptable" · **Owner lane:** one Opus agent, reviewed by Fable

## What is wrong

`packages/api/src/rest` holds 52 source files and `trpc` 23, 16,019 lines together. Two transports
live there: the old builder family (`createServiceApp`, `createVersionedApp`, `createRestService`,
`createProjectApp`, `createOrgApp`, `createServiceVersionedApp`, `createProjectVersionedApp`,
`createTrpcService`, `createTrpcApiService`, `mountProjectTransport`, `mountProjectRestRouter`)
and the new runtime (`defineRestRouter` + `createRestRuntime`, `defineTrpcRouter` +
`createTrpcRuntime`, `defineTrpcContract`). Only annotation, agent, log and notification are on the
new one. 230 files in 44 features and `apps/api` still call the builders. They break when the
builders go. That is intended: every feature converts or it does not build.

## Target

```
packages/api/src/
  index.ts  errors.ts  access-policy.ts  ports.ts  schema.ts  websocket.ts  composition.ts
  access/access.ts
  contract/index.ts  contract/trpc-contract.ts
  web/index.ts  web/module-api.ts  web/trpc-query-key.ts  web/use-invalidate-procedure.ts
  rest/
    index.ts        public names only
    runtime.ts      createRestRuntime, mount, version selection, v1 alias, route registry
    request.ts      validation, body limit, middleware, SSE, idempotency (ledger included)
    credential.ts   credential types, principal resolution, scope accessors, personal caller
    response.ts     response shaping, base responses, media response, HTTP errors, error handlers,
                    JSON protocol, shared schemas, the types that were types.ts
    openapi.ts      document generation, security requirement, exclusive bounds, hand-written docs,
                    deprecation headers, endpoint capabilities, platform URL
    security.ts     the process security kernel the doors compose: rest-api-service, route
                    declaration, app security, auth diagnostics, internal secret, management audit
  trpc/
    index.ts        public names only
    runtime.ts      createTrpcRuntime, router, handler, root, error formatter
    policy.ts       permission builder, declared authz, runtime policy, policy ports and context,
                    scope lineage — whatever the process still needs to build `procedure`
    audit.ts        audit, redaction, call logging, caller trace, failure trace
```

Nine transport files where there were 77. Tests follow the same fold: one `__tests__/<file>.unit.test.ts`
per target file (integration and compiler tests keep their suffix), and the three trpc tests that sit
beside their sources move into `__tests__`. Nothing under `rest/` or `trpc/` other than these files
and `__tests__/`. No `security/` subfolder.

## Method

1. **Draw the line.** Legacy = the eleven builder names above, the files that define them
   (`builder.ts`, `definition.ts`, `pipeline.ts`, `route-mounting.ts`, `transport-mount.ts`,
   `project-transport.ts`, `public-rest-routing.ts`, `public-rest-input.ts`, `create-rest-router.ts`,
   `trpc-service-builder.ts`, `trpc-api-service.ts`, `create-trpc-router.ts`, `versioning.ts` where it
   serves the builders, `management-version.ts`), and any file only they reach. Compute it: build the
   relative-import graph of `packages/api/src`, take the closure from the builder files, subtract the
   closure from the new runtime entries (`rest-runtime.ts`, `rest-router.ts`, `rest-openapi.ts`,
   `trpc-runtime.ts`, `trpc-router.ts`, `contract/`, `web/`, `access/`, the package root) **and**
   from what `apps/api/src/app/*.ts` and `apps/api/src/features/{annotation,agent,log,notification}/**`
   import through non-builder names. What remains is deleted. Put the resulting list in the report.
2. **What the new runtime must absorb before the delete lands** (the product still promises these;
   `packages/api/specs/*.feature` is the oracle): the idempotency ledger (`idempotency-ledger.ts`,
   `idempotency-fingerprint.ts`) into `request.ts`; the personal caller into `credential.ts`;
   management audit into `security.ts`; deprecation headers, endpoint capabilities, hand-written docs
   and platform URL into `openapi.ts`; broadcast into `request.ts` or delete it if nothing outside
   the builders reads it (say which). Read the spec scenarios bound to each before moving it, and keep
   every binding.
3. **Fold.** Move code into the target files with Read and Write, module by module, keeping every
   exported name that survives and every test. Colocate types with their one user; `types.ts` dies.
   Comments stay ≤5 lines; a file-level docblock names the concept the file is. No re-exports from
   the old paths; the barrels list the surviving public names once.
4. **Delete** the legacy files and every test that only tested them. `rest/index.ts`,
   `trpc/index.ts`, `src/index.ts` and `package.json` `exports` drop the legacy names.
5. **Prove the package alone.** `pnpm typecheck:one packages/api`, `pnpm --filter @langwatch/api
   test:unit`, `npx oxlint packages/api/src`, `pnpm --filter @langwatch/architecture-lint test
   tests/api-package-files.unit.test.ts tests/api-transport-boundaries.test.ts`, and
   `node dev/scripts/check-feature-parity.ts` for `packages/api/specs` staying 100% bound.
   `apps/api` and the 44 features are expected red; do not touch them.

## Allowed paths

`packages/api/**` only, plus `packages/architecture-lint/tests/api-package-files.unit.test.ts`
(its `TARGET_FILES` list is the new layout) and `packages/architecture-lint/src/api-transport-boundaries.ts`
if it names a deleted file. Not baselines, not `apps/`, not `packages/features/**`.

## Rules for the lane

Opus. Edit/Write tools for every change (no sed or scripted rewrites over files you have not read;
`rm` for deletions). Never run root `pnpm typecheck`, `typecheck:all`, `lint`, `format`. No git writes.
No `.env*`. No re-exports, no `as unknown as`, no `try*` methods, no inline `import()`. Keep every
spec binding tag and `@scenario` annotation.

## Report

1. The legacy list you deleted (file, lines) and the files you kept and why, one line each.
2. The target files with their line counts.
3. Public names removed from `@langwatch/api`, `./rest`, `./trpc` (this is what the 44 conversions
   will hit) and public names kept.
4. Exit check outputs verbatim.
5. Anything a spec scenario needed that you could not place.
