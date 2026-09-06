---
name: api-rest-route
description: "Add or change one public REST endpoint the ADR-128 way: declare its input, output and permission in the feature's contract, write the transport/public-rest builder class, pick the AccessPolicy and its scope, mount it through the family class in apps/api, regenerate the OpenAPI description with the task instead of hand-editing the frozen document, and bind the scenario. Use whenever someone says 'add a REST endpoint', 'expose this over the public API', 'a new /api/v1/... route', 'API key access to X', or asks why a new route 404s, is missing from the OpenAPI document, or answers 403. Do not use it to change a legacy transport/api-rest Hono family unless the goal is only to keep an existing URL working."
user-invocable: true
argument-hint: "<feature> <method and path, e.g. 'POST /api/v1/secret'>"
---

# Add a public REST endpoint

Read `.claude/skills/architecture-guide/references/server.md` and `contract.md` first.
The reference implementation is `secret`, end to end:

```
packages/features/secret/contract/src/secret.queries.ts        the declaration
packages/features/secret/server/src/transport/public-rest/secret.api.ts   the builder
apps/api/src/api-secret-rest.feature.ts                        the mount
packages/api/src/access-policy.ts                              the policies
```

`transport/api-rest/**` is the compatibility surface. New endpoints go in
`transport/public-rest/`.

## 1. Spec first

Scenarios in the feature's own `specs/*.feature`: the golden path, the refusal for each
named error, the authorization refusal. Tag and bind per the `spec-bind` skill. Framework
behaviour (rate limiting, caching, deprecation headers) is already specified in
`packages/api/specs/endpoint-capabilities.feature`; do not restate it.

## 2. Declare the operation in the contract

In `<subject>.queries.ts` (reads) or `<subject>.commands.ts` (writes), add the input and
output schemas, then the operation to the package's `…PublicRest` record:

```ts
export const secretPublicRest = {
  list: {
    input: secretPublicListInputSchema,
    output: z.array(secretPublicSchema),
    permission: "secrets:view",
  },
} as const satisfies Record<string, SecretRestOperation<ZodType, ZodType>>;
```

- Output schemas are `.strict()`, so a field the projection must never carry cannot join
  an answer by accident. Add a `to<Subject>Public(...)` projection beside it.
- `permission` is an `AuthzPermission` from `@langwatch/authz-contract`; the scope id it
  is checked against (usually `projectId`) is a required field of the input schema.

## 3. Write the builder

`packages/features/<f>/server/src/transport/public-rest/<subject>.api.ts` — a class with
a private constructor, `static create()` and `install(api, options?)`:

```ts
export const SECRET_PUBLIC_API_VERSION = "2026-08-24" as const;

export class SecretPublicRestApi {
  private constructor() {}
  static create(): SecretPublicRestApi {
    return new SecretPublicRestApi();
  }

  install<TApplication extends SecretApp>(api: RestService<TApplication, false, true, true>) {
    api.post("/", SECRET_PUBLIC_API_VERSION, (endpoint) =>
      endpoint
        .withInput(secretPublicRest.create.input)
        .withOutput(secretPublicRest.create.output)
        .withPermission(secretPublicRest.create.permission, { scope: "projectId" })
        .withStatus(201)
        .withDocs({
          operationId: "createSecret",
          summary: "Create a project secret",
          tags: ["Secrets"],
        })
        .handle(async (context, input) =>
          toSecretPublic(await context.app.create(input, context.actor())),
        ),
    );
    return api;
  }
}
```

- The handler reads `context.app`, `context.actor()` and the validated `input`, calls
  exactly one application operation and returns a value. It never touches a repository,
  constructs a service, reads `process.env` or answers `c.json({ error }, status)` —
  throw the contract's `HandledError` and the spine serialises it.
- `withDocs.operationId` is unique across every mount, alias base paths included; the
  family passes an `operationIdSuffix` for those.
- The version string is a date. Bump it, and add the date to the family's
  `RestVersionSelector`, only when the wire shape changes for existing callers.
- Export the class from the server package `index.ts`.

## 4. Mount it in apps/api

For a new family, add `apps/api/src/api-<f>-rest.feature.ts` modelled on
`api-secret-rest.feature.ts`: a class whose `create({ <service>, security })` builds the
feature's `App`, calls `createRestService<App>({ name, basePath, staticVersioning,
maxInputBytes, app, actor, authorize, auth, permissionEnforcer, projectIdInput,
openapiSecurity, onRouteMounted })`, states `withoutRateLimit(reason)` /
`withoutResourceLimit(reason)` where no such port is composed, and returns
`XPublicRestApi.create().install(rest).build()`.

`onRouteMounted` puts every mount in the route-policy registry with an `AccessPolicy`
from `@langwatch/api` (`packages/api/src/access-policy.ts`):

| Policy                    | Use                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `apiKeyPermission(p)`     | a project API key holding permission `p` — the normal case |
| `requiresOnProject(p)`    | a session caller on a project scope                        |
| `requiresOnTeam(p)`       | a session caller on a team scope                           |
| `anyAuthenticated()`      | any authenticated caller, no permission                    |
| `publicEndpoint(reason)`  | genuinely unauthenticated; the reason is recorded          |
| `internalSecret(reason)`  | service-to-service behind a shared secret                  |
| `handlerManagedAuth({…})` | the handler does the check itself; say what and why        |

Throw if a mounted route declares no permission and is not a namespace guard — a route
served with a real check and no recorded policy is the one state the endpoint
authorization audit cannot tell from a route that bypassed the builder.

Then wire the family in `apps/api/src/app/api-production.composition.ts`, mounted only
when its service was composed (`secrets ? ApiSecretRestFeature.create({…}) : new Hono()`),
and export it from `apps/api/src/index.ts` if the OpenAPI surface needs it. Add it to
`apps/api/src/tasks/openapi-document/openapi-document.surface.ts` so the description
covers it.

Extending an existing legacy family instead? Its entry is in
`apps/api/src/app-rest/app-rest.packaged-families.ts`, condition-gated on its service.

## 5. OpenAPI

```bash
pnpm --filter @langwatch/platform-api task openapi-generate /tmp/openapi.json
pnpm --filter @langwatch/platform-api task openapi-check /tmp/openapi.json
```

`openapi-generate` describes the routes this process serves and never writes
`apps/api/src/features/discovery/openapi-document.json`: that artifact is frozen, routes
serve it and both SDKs generate clients from it, so replacing it is a decision a person
makes with the diff in front of them. Never hand-edit it. `openapi-check` fails only in
the breaking direction — the frozen document lists an operation no route serves.

## 6. Tests

- `packages/features/<f>/server/src/transport/public-rest/__tests__/` — the idiom is
  `secret.public-rest.api.unit.test.ts`: build the service over a fake app and assert the
  golden path, the refusal for each declared error, and a call without the permission.
- `apps/api/src/__tests__/api-<f>-rest.listener.integration.test.ts` is the idiom for a
  caller-level test through the real mount
  (`api-secret-rest.listener.integration.test.ts`).
- Assert on error `code` and status, never on message prose.

## 7. Gates

`.claude/skills/architecture-guide/references/gates.md`, plus:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test
pnpm --filter @langwatch/platform-api test:unit run src/__tests__/api-<f>-rest.listener.integration.test.ts
pnpm --filter @langwatch/<f>-server typecheck && pnpm --filter @langwatch/platform-api typecheck
```

## Report

The operations added with method, path and version; the permission and `AccessPolicy` for
each; the scenarios and the tests that bind them; whether the frozen OpenAPI document
needs a human diff; anything left absent by design.
