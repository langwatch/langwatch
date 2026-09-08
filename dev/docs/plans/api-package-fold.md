# Fold the two satellite packages into `@langwatch/api`

**Date:** 2026-09-08 · **Ruling:** Alex, "get rid of both and we put them inside the API" · **Owner lane:** one Opus agent, reviewed by Fable

## Target

```
@langwatch/api                 the whole transport, three doors
  ./contract                   defineTrpcContract + its types        (browser-safe, zod only)
  ./web                        createFeatureApi, WireOf, OutputsFromMap, trpcQueryKey,
                               trpcQueryFilter, useInvalidateProcedure  (react + trpc react-query)
  .  ./rest  ./trpc  ./access  ./composition   unchanged

@langwatch/runtime-composition the DI package
  .                            featureApi, FeatureApiToken, FeatureName already exported here
  ./contract                   DELETED
  src/contract.ts, src/trpc-contract.ts   DELETED (the builder moves to packages/api)

packages/platform-api-client   DELETED
```

`featureApi` stays in runtime-composition: it is the DI token the registry keys on, and the
root depends on zod alone. Only the alias subpath dies. `defineTrpcContract` is transport
vocabulary and moves home.

## The cycle, and how it breaks

`@langwatch/api` imports feature contracts in four places. A contract that imports
`@langwatch/api/contract` back is a declaration-project cycle (`dev/tsconfig.declarations.json`
refuses it). Break the three that can be broken now; authz stays and is the phase 3 item.

| Import in `packages/api` | Replacement |
| --- | --- |
| `rest/variables.ts`: `ResolvedApiKeyCredential`, `ResolvedOrganizationApiKeyToken` from api-key-contract | Structural types declared in `packages/api/src/rest/credential.ts`: the fields the transport actually reads (id, kind/class, projectId or organizationId, permission mode). The process door (`apps/api`) hands in the api-key feature's value; the type check is structural. |
| `rest/credential-principal.ts`: same package | Same types. |
| `rest/variables.ts`: `ProjectIdentity` from project-contract | Structural `{ id: string; teamId: string; organizationId: string; ... }` limited to fields the transport reads. |
| `rest/media-response.ts`: `isReadbackSafe` from stored-object-contract | A `readbackSafe(mediaType)` predicate supplied by the caller of the media response, or the predicate moves into `packages/api` if it is transport logic. Read it first and pick. |
| `@langwatch/authz-contract` (20 files) | Stays. authz-contract does not import `defineTrpcContract` today. Note it in the report as the phase 3 cycle. |

Remove the three packages from `packages/api/package.json` dependencies. `pnpm install` with
`CI=true pnpm install --no-frozen-lockfile` from the repo root is allowed and expected, once.

## Moves (git-free: copy content with Write, delete with rm inside the paths below)

1. `packages/runtime-composition/src/trpc-contract.ts` → `packages/api/src/contract/trpc-contract.ts`
   (replace the 21-line re-export shim there with the real file; keep its tests moving with it if any).
2. `packages/platform-api-client/src/feature-api.ts` → `packages/api/src/web/feature-api.ts`
   `packages/platform-api-client/src/trpc-query-key.ts` → `packages/api/src/web/trpc-query-key.ts`
   `packages/platform-api-client/src/use-invalidate-procedure.ts` → `packages/api/src/web/use-invalidate-procedure.ts`
   `packages/platform-api-client/tests/trpc-query-key.unit.test.ts` → `packages/api/src/web/__tests__/trpc-query-key.unit.test.ts`
   One `packages/api/src/web/index.ts` exporting the public names (no other barrels).
3. `packages/api/package.json`: add `"./web"` export (types `./dist/web/index.d.ts`, default `./src/web/index.ts`);
   add `react`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query` at the versions
   platform-api-client pins (`@types/react` dev). `tsconfig.build.json` `files` gains `./src/web/index.ts`;
   check `jsx`/`lib` settings compile the hook.
4. Delete `packages/platform-api-client` entirely, `packages/runtime-composition/src/contract.ts`,
   `packages/runtime-composition/src/trpc-contract.ts`, and the `./contract` entry in
   `packages/runtime-composition/package.json`.

## Rewrites (mechanical, by import specifier)

| From | To | Sites |
| --- | --- | --- |
| `"@langwatch/runtime-composition/contract"` | `"@langwatch/runtime-composition"` | 112 files; `defineTrpcContract` sites (annotation, agent) go to `"@langwatch/api/contract"` instead |
| `"@langwatch/platform-api-client/feature-api"`, `/query-key`, `/invalidate`, bare | `"@langwatch/api/web"` | 125 files |
| `"@langwatch/platform-api-client"` in 36 web `package.json` | `"@langwatch/api": "workspace:*"` | plus their `tsconfig.json` / `tsconfig.build.json` references to `platform-api-client/tsconfig.build.json` → `api/tsconfig.build.json` |
| `dev/tsconfig.declarations.json`, `dev/tsconfig.web-declarations.json` | drop the platform-api-client reference | |

**Skip `packages/features/api-key/**` entirely** (10 files): Kimi is editing that feature. List
the exact lines in the report; Fable applies them.

## Lint and docs that name the old paths

- `packages/architecture-lint/src/feature-layout.ts` ~line 77: the rule "a portable feature API may
  import only the runtime-composition contract subpath" becomes: a contract package importing
  `@langwatch/runtime-composition` may bind only `featureApi`, `FeatureApiToken`, `FeatureName`
  (check the import's named bindings, not the path). Update its message, its test, and
  `packages/architecture-lint/specs/*.feature` line if one names the subpath.
- `packages/architecture-lint/src/feature-app-contract.ts` lines ~329, ~394, ~585: the helper
  specifier is now `@langwatch/runtime-composition`.
- `packages/architecture-lint/src/frontend-ui-boundaries.ts` ~107: the allow regex names
  `@langwatch/api/web`. Confirm web packages may import `@langwatch/api/web` and nothing else
  from `@langwatch/api`; if the rule needs a subpath allow-list, add it there.
- `packages/architecture-lint/src/comment-block-roots.json`: drop the platform-api-client root, add
  nothing (packages/api is already a root).
- `.claude/skills/architecture-guide/references/web.md`: replace the package name.
- Any `README.md` or ADR under `packages/api`, `packages/runtime-composition`,
  `packages/platform-api-client` that documents the import path: update the sentence, delete
  the shim's comment block.
- Baselines (`oxlint-baseline.json`, `packages/architecture-lint/src/*-baseline.json`): do not
  edit. List keys that move (old path → new path) in the report.

## Rules for the lane

- Opus. Edit/Write tools for every change; no sed or scripted rewrites over files you have not
  read. No re-exports anywhere, no `as unknown as`, no `try*` methods, comments ≤5 lines.
- Never run `pnpm typecheck`, `typecheck:all`, `lint` or `format` at the root. Allowed:
  `pnpm typecheck:one packages/api`, `pnpm typecheck:one packages/runtime-composition`,
  `pnpm typecheck:one <one web package you changed>`, `pnpm --filter @langwatch/api test:unit`,
  `pnpm --filter @langwatch/architecture-lint test`, `npx oxlint <files you changed>`.
- No git commands that write (no add, commit, stash, checkout, mv, rm --cached). `git grep` is fine.
- Do not touch `packages/features/api-key/**`, `*-baseline.json`, `.env*`.
- Do not read or print any environment value.

## Exit checks (paste outputs in the report)

```
grep -rn "runtime-composition/contract" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.mjs' --include='*.md' apps packages dev .claude | grep -v node_modules | grep -v api-key
grep -rn "platform-api-client" apps packages dev tools .claude docs --include='*' -l | grep -v node_modules | grep -v pnpm-lock | grep -v api-key
ls packages/platform-api-client 2>&1
pnpm typecheck:one packages/api && pnpm typecheck:one packages/runtime-composition && pnpm typecheck:one packages/features/annotation/contract && pnpm typecheck:one packages/features/annotation/web
pnpm --filter @langwatch/api test:unit
pnpm --filter @langwatch/architecture-lint test
```

## Report format

1. Files created / deleted / rewritten (counts per directory).
2. The api-key lines Fable must apply (file:line, old specifier → new).
3. Baseline keys that move.
4. Exit check outputs, verbatim.
5. Anything in a lint rule you changed and why (one line each).
6. The authz cycle note, and anything you could not do.
