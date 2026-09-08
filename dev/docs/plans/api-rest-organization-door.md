# Wave 3: the organization door on the declared REST path

**Date:** 2026-09-08 · **Owner lane:** one Opus agent · **Reviewer:** Fable (this file is the brief)

## Why

Phase 1 of `dev/docs/plans/api-package-rebuild.md` built the one REST execution path
(`packages/api/src/rest/rest-router.ts` + `rest-runtime.ts` + `rest-openapi.ts` +
`access/access.ts`). It serves one credential today: a project API key. The runtime hands
every handler `scope: { tier: "project" }` and throws for anything else
(`rest-runtime.ts` `projectScopeOf`).

Ten management families authenticate with an **organization** key instead (`/api/roles`,
`/api/teams`, `/api/groups`, `/api/organizations`, `/api/projects`, `/api/api-keys`,
`/api/webhooks`, `/api/v1/coding-agent`, gateway spend, SCIM). All ten still run through
`security.createVersionedApp(...)`, the legacy path scheduled for deletion in phase 3. None
of them can move until the declared path has an organization door. That is this wave.

## Target shape

The declaration names its credential. The handler's `scope` follows it. The process supplies
the door. Nothing else changes.

```ts
// packages/features/role/server/src/transport/role.rest.ts
export const roleRest = defineRestRouter(RoleApi)
  .withNamespace("roles")
  .withVersion("2026-08-07")
  .withCredential("organizationKey")          // NEW: was named on the mount

  .get("/", "listRoles")
  .withPermission("organization:manage")
  .withOutput(roleRestListResponseSchema)
  .withDocs({ summary: "List the organization's roles" })
  .handle(async ({ app, scope, actor }) => {
    //                   ^ scope: { tier: "organization"; id: string }  (typed by the credential)
    return { data: await app.list({ organizationId: scope.id }) };
  })
  // ...five more routes, one per operation the legacy family serves today
```

```ts
// apps/api/src/features/role/role-rest.mount.ts
export function mountRoleRest(options: {
  roles: () => RoleApi;
  door: ApiOrganizationDoorPort;          // the process's organization credential boundary
  enterpriseGate: MiddlewareHandler;
}): MountableRestApp {
  const runtime = createRestRuntime({ identity: { authenticate: options.door } });

  return runtime.mount(roleRest.router(), {
    app: options.roles,
    middleware: [options.enterpriseGate],
    onError: createFamilyErrorHandler({ envelope: "canonical" /* as today */ }),
  });
}
```

```
request ─► parse ─► identity.authenticate({ request, permission })
                        │  organization key?  ── no ──► ApiOrganizationCredentialClassMismatchError (401)
                        │  resolves?          ── no ──► ApiOrganizationInvalidCredentialsError (401)
                        │  holds permission?  ── no ──► ApiOrganizationPermissionError (403)
                        ▼
                    { actor, scope: { tier: "organization", id }, markUsed }
                        ▼
                    decide(service-authorized) ─► handler({ app, input, actor, scope }) ─► output guard ─► respond
```

The door is the process's. It composes the three checks `ApiRestSecurity` already performs
for the legacy organization strategy (`authenticateOrganizationThrowing`,
`authorizeOrganizationPermissionThrowing`, the class-mismatch refusal) into one
`authenticate` function. **Do not write a second credential resolver.** The refusal bodies
and statuses are wire facts; the existing test `api-rest.roles-family.integration.test.ts`
pins them.

## What changes, file by file

### `packages/api` (three files, one spec, tests)

1. `rest/rest-router.ts`
   - `RestTransportRouter` gains `.withCredential(credential: Credential)` after
     `.withVersion(...)`. The declaration (`RestTransportDeclaration`) carries `credential`.
   - The handler's `scope` type is derived from the credential:
     `projectKey → { tier: "project" }`, `organizationKey → { tier: "organization" }`.
     `session`, `internalSecret` and `public` are out of scope for this wave: refuse them at
     the type level (`never`) with a one-line comment saying which wave brings them.
   - A router with no `.withCredential(...)` does not compile. Annotation therefore gains one
     line: `.withCredential("projectKey")` in `annotation.rest.ts`, and its mount drops the
     `credential:` option. That is the whole annotation change.
2. `rest/rest-runtime.ts`
   - `RestMountOptions.credential` is deleted; the runtime reads `declaration.credential`.
   - `projectScopeOf` becomes `scopeOf(declaration.credential, caller.scope)`: it asserts the
     tier the credential implies and throws the same wiring error otherwise.
   - `CREDENTIAL_CLASS`, `HANDLER_CREDENTIAL` and `registryPolicy` already know
     `organizationKey`. Verify with a test, do not re-derive.
   - Nothing else. The runtime is already over the plan's size; if you find yourself adding
     a branch per credential, stop and put the per-credential facts in one small table.
3. `rest/rest-openapi.ts`
   - `securityRequirement(declaration.credential)` publishes `admin_api_key` for an
     organization route. That function exists in `access/access.ts`; call it.
4. `packages/api/specs/transport-declaration-split.feature`: five scenarios, each tagged and
   bound to a test with `@scenario`:
   - **A declaration names the credential its routes accept**
   - **A handler on an organization door receives the organization scope, never a project**
   - **A project key presented to an organization route is refused with the body the family
     already publishes**
   - **A route on an organization door is refused for a key whose bindings lack the
     declared permission**
   - **An organization route publishes the organization security scheme**
5. `rest/__tests__/rest-runtime.integration.test.ts`: the existing "same declaration through
   the runtime and through the legacy mount yields deep-equal `generateSpecs(...).paths`
   and equal route tables" proof, repeated for the role declaration against
   `createVersionedApp` on the organization strategy.
6. `packages/api/README.md`: the **Mounting a declaration** section shows the credential on
   the router; one sentence names the two doors that exist.

### `packages/features/role` (the reference conversion)

7. `contract/src/role-rest.schemas.ts`: params, query, body and response schemas for the six
   operations, lifted from `role.api.ts` unchanged (shape, names, descriptions, examples).
   `contract/src/role.api.ts`: the six operations on `RoleApi`, if they are not already
   there. Do not invent operations the legacy family does not serve.
8. `server/src/transport/role.rest.ts`: the declaration. Six routes, inline handlers, each
   handler a few lines calling one `app` method. The permission catalogue route keeps
   reading the process vocabulary the way it does today: that is a collaborator on the app,
   not a second handler argument.
9. The audit actor string. `managementActor(c)` answers the user id for a user-bound key and
   `apikey:<id>` for a service key. The handler now has `actor` instead of a Hono context:
   write one rules function `auditActorOf(actor)` in `server/src/rules/` producing the same
   strings, pin both cases with a unit test, and use it wherever the legacy family called
   `managementActor` or `emitManagementAudit`.
10. Delete `server/src/transport/api-rest/role.api.ts` and everything only it imported.
    Delete, do not re-export.

### `apps/api` (one new file, one door, one wiring line)

11. `src/features/role/role-rest.mount.ts` as sketched above.
12. The organization door port. Add `organizationDoor` beside `handlerManagedCredential` on
    the ports the packaged families receive (`app-rest.process-features.ts`), built in the
    same place `ApiRestSecurity` is built, from its existing methods. Its shape is the
    runtime's: `({ request, permission }) => Promise<RestCaller>`, throwing the family's
    existing `HandledError` subclasses. Mirror `ApiHandlerManagedCredentialPort`, but throw
    rather than return `{ ok: false }`: the `{ ok, error }` result shape is banned.
13. Replace the `createRoleRestApp(...)` mount with `mountRoleRest(...)` where the roles
    family is wired today (`app-rest.packaged-families.ts`). One line out, one line in.

## Wire oracle: nothing an integrator sees may change

- `apps/api/src/features/discovery/openapi-document.json` and
  `docs/api-reference/openapiLangWatch.json`: `git diff --stat` on both must be empty after
  regenerating. The eight `/api/v1/roles*` paths, their security (`admin_api_key`), status
  codes, response schemas and descriptions are the contract.
- `apps/api/src/app-rest/__tests__/api-rest.roles-family.integration.test.ts` and
  `api-rest.endpoint-authorization.integration.test.ts` pass unedited except for
  `@scenario` annotations.
- Refusal bodies: missing credential 401, project key on the organization door 401 with
  `required: "organization_api_key"`, key without `organization:manage` 403, enterprise gate
  refusal unchanged. Read them off the tests, not off memory.
- Route registry: each role route records `organization_api_key` as its credential class
  and `organization:manage` as its permission.

## Guardrails

- **Lift and shift.** Handlers move as they are. No renamed fields, no new validation, no
  "while I'm here". A behaviour you think is wrong goes in the report, not in the code.
- **No `try*` names, no `{ ok, error }` results, no `as unknown as`, no re-exports, no
  inline `import()`, comments at most five lines and 100 columns, named-object parameters.**
  `pnpm exec oxlint --config .oxlintrc.architecture.json <file>` on every file you touch
  must be clean of new findings.
- **Only these paths:** `packages/api/src/rest/{rest-router,rest-runtime,rest-openapi}.ts`
  and their tests, `packages/api/specs/`, `packages/api/README.md`,
  `packages/features/role/**`, `packages/features/annotation/server/src/transport/annotation.rest.ts`
  (one line), `apps/api/src/features/annotation/annotation-rest.mount.ts` (one line),
  `apps/api/src/features/role/**`, `app-rest.process-features.ts` and
  `app-rest.packaged-families.ts` (the door port and the one wiring line). Anything else
  you believe you need: stop and report which file and why.
- **Never** run `git add`, `git commit`, `git stash`, `git checkout`, or any git write. Never
  edit a `*-baseline.json`; list the lines to delete in the report. Never run root
  `pnpm typecheck`, `pnpm lint` or `pnpm format`; use `pnpm typecheck:one <package>` and
  the per-package `test:unit` scripts. Never read `.env*`.
- `packages/api` uses project references: a bare `tsc --noEmit` reads stale
  `dist/*.d.ts`. Always `pnpm typecheck:one packages/api`.
- Another agent is editing `apps/api/src/app/*` and `packages/features/agent/**` right now.
  Do not touch either. If `app-rest.process-features.ts` changes under you, re-read it
  before editing and keep your edit to the port and the wiring line.

## Exit checks (run all, paste the summary lines)

```
pnpm --filter @langwatch/api test:unit
pnpm typecheck:one packages/api
pnpm typecheck:one packages/features/role/server
pnpm typecheck:one packages/features/role/contract
pnpm --filter @langwatch/role-server test:unit
pnpm --filter @langwatch/role-contract test:unit
pnpm --filter @langwatch/annotation-server test:unit
pnpm --filter @langwatch/platform-api test:unit src/features/role src/features/annotation \
  src/app-rest/__tests__/api-rest.roles-family src/app-rest/__tests__/api-rest.endpoint-authorization \
  src/app-rest/__tests__/api-rest.annotation-family
grep -rn "as unknown as\|createVersionedApp\|managementActor\|organizationOf(" packages/features/role
git status --porcelain apps/api/src/features/discovery/openapi-document.json docs/api-reference/openapiLangWatch.json
```

The two greps must print nothing. The `git status` must print nothing after you regenerate
the document with the discovery task.

## Report format

1. Outcome in two sentences.
2. Files changed, one line each, grouped as above.
3. Scenarios added and the test binding each.
4. Suite results table.
5. Line counts of `rest-router.ts`, `rest-runtime.ts`, `rest-openapi.ts` before and after.
6. Baseline lines to delete (`feature-shape-baseline.json`; the api-package-files ratchet is now the
   `TARGET_FILES` set in `packages/architecture-lint/tests/api-package-files.unit.test.ts`).
7. Left open: every wire fact you could not preserve, every file you wanted and were not
   allowed, every legacy behaviour you think is a bug. Facts, not proposals.
