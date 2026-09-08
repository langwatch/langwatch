---
name: api-rest-route
description: "Add or change one public REST endpoint the annotation way: declare its params, query, body and response schemas in the feature's contract, add the operation to the <Feature>Api, write the inline handler on the feature's flat transport/<f>.rest.ts declaration (defineTransport from @langwatch/api/rest) with its permission and docs, mount the declaration through the process's REST family in apps/api/src/features/<f>/<f>-rest.mount.ts, regenerate the OpenAPI description with the task instead of hand-editing the frozen document, and bind the scenario. Use whenever someone says 'add a REST endpoint', 'expose this over the public API', 'a new /api/v1/... route', 'API key access to X', or asks why a new route 404s, is missing from the OpenAPI document, or answers 403. Do not add routes to a legacy transport/api-rest or transport/public-rest folder; those are inventoried by feature-shape and go away when the feature converts."
user-invocable: true
argument-hint: "<feature> <method and path, e.g. 'POST /api/annotations/trace/:id'>"
---

# Add a public REST endpoint

Read `.claude/skills/architecture-guide/references/server.md` and `contract.md` first.
The reference implementation is `annotation`, end to end:

```
packages/features/annotation/contract/src/annotation-rest.schemas.ts   params, query, body and response schemas
packages/features/annotation/contract/src/annotation.api.ts            the operation the handler calls
packages/features/annotation/server/src/transport/annotation.rest.ts   the declaration with inline handlers
apps/api/src/features/annotation/annotation-rest.mount.ts              the process mount (credential, family, refusal bodies)
packages/api/src/rest/transport.ts · transport-mount.ts                defineTransport and mountProjectTransport
```

`transport/api-rest/**` and `transport/public-rest/**` are the older spelling; a
feature that still has one is listed in
`packages/architecture-lint/src/feature-shape-baseline.json` (`nested-transport`). New
endpoints go on the flat declaration even in such a feature; if the feature has no flat
declaration yet, create `transport/<f>.rest.ts` and mount it (step 4) rather than adding to
the folder.

## 1. Spec first

Scenarios in the feature's own `specs/*.feature`: the golden path, the refusal for each
named error, the authorization refusal. Tag and bind per the `spec-bind` skill. Framework
behaviour (rate limiting, caching, deprecation headers) is already specified in
`packages/api/specs/endpoint-capabilities.feature`; do not restate it.

## 2. Declare the shapes in the contract

In `<f>-rest.schemas.ts`: a params schema whose keys are exactly the `:name` segments of
the path, a query schema, a body schema, and the response schemas. Keys must not collide
across params, query and body (the framework merges them into one `input`).

```ts
export const annotationRestParamsSchema = z.object({ id: z.string().min(1) });
export const annotationRestQuerySchema = z.object({ anchor: annotationAnchorScopeSchema.default("all") });
export const annotationRestWriteSchema = z.object({ comment: z.string().min(1), isThumbsUp: z.boolean() });
export const annotationRestResponseSchema = z.object({ data: z.looseObject(annotationSchema.shape) });
```

The operation the handler will call is a method on `interface <F>Api` in `<f>.api.ts`;
add it there if it is new (`feature-extend` step 2), and the app implements it.

## 3. Write the handler on the declaration

`packages/features/<f>/server/src/transport/<f>.rest.ts`:

```ts
export const annotationRest = defineTransport(AnnotationApi)
  .withVersion(MANAGEMENT_API_VERSION)
  .withRouter((router) =>
    router
      .post("/trace/:id", "createTraceAnnotation")
      .withParams(annotationRestParamsSchema)
      .withInput(annotationRestWriteSchema)
      .withPermission("annotations:create")
      .withOutput(annotationRestResponseSchema)
      .withDocs({ summary: "Create an unattributed annotation on a trace" })
      .handle(async ({ app, input, scope }) => {
        const annotation = await app.createUnattributed({ ...input, projectId: scope.id, traceId: input.id });
        return { data: annotation };
      })

      .delete("/:id", "deleteAnnotation")
      .withParams(annotationRestParamsSchema)
      .withPermission("annotations:manage")
      .withDocs({ summary: "Delete an annotation in the caller’s project" })
      .handle(async ({ app, input, scope }) => {
        await app.delete({ id: input.id, projectId: scope.id });
      }),
  );
```

- `.get/.post/.patch/.put/.delete(path, operationId)`: the path is relative to the
  family's base path, the operation id is unique across every mount.
- `.withParams` / `.withQuery` / `.withInput` declare the sources; `input` is their merge,
  already parsed. `.withOutput` is mandatory for any route that returns a value; a
  no-content route declares none and returns `void`.
- `.withPermission(permission)` names the `AuthzPermission` the framework checks against
  the authorized `scope` (`{ tier: "project", id }`) before the handler runs; a route
  without one must say why with the declared alternative kinds (`withoutPermission`).
- The handler reads `{ app, input, actor, scope, signal }`, calls exactly one app
  operation and returns a value. It never touches a repository, constructs a service,
  reads a header or `process.env`, or builds a `Response`; throw the contract's
  `HandledError` and the framework serialises it.
- `.withVersion` is the date-based version of the whole declaration; bump it only when
  the wire shape changes for existing callers.
- Export the declaration from the server package `index.ts` and list it in
  `<f>.server.ts`'s `.withTransports(...)`.

## 4. Mount it in apps/api

`apps/api/src/features/<f>/<f>-rest.mount.ts`, modelled on annotation's:

```ts
export function mountAnnotationRest(options: { security: AppRestSecurity; annotations: () => AnnotationApi; credential: ApiHandlerManagedCredentialPort }): MountableRestApp {
  const family = options.security.createServiceVersionedApp({ name: "annotations", basePath: "/api/annotations", errorEnvelope: "legacy", errorHandler });
  mountProjectTransport({
    family,
    transport: annotationRest.router(),
    app: options.annotations(),
    credential: "apiKey",
    authenticate,               // resolves the API key, sets the project scope with setProjectTransportAuthorization
    authorize: () => {},
    afterSuccess: ({ context }) => callerOf(context).markUsed(),
  });
  return family.service.build();
}
```

The mount owns everything process-specific: which credential, the base path, the error
envelope, historical refusal bodies for callers that depend on them. The feature owns the
routes. The root (`apps/api/src/app/api-production.composition.ts`) registers the family
only when the feature was installed. A brand-new family is also added to
`apps/api/src/tasks/openapi-document/openapi-document.surface.ts` so the description
covers it.

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

- `packages/features/<f>/server/src/transport/__tests__/<f>.rest.integration.test.ts`:
  mount the declaration through the harness host over `create<F>TestApp()` and assert the
  golden path, the refusal for each declared error, and a call without the permission.
- `apps/api/src/features/<f>/__tests__/<f>.composition.integration.test.ts` drives the
  real mount with `createApiFixture` peers.
- Assert on error `code` and status, never on message prose.

## 7. Gates

`.claude/skills/architecture-guide/references/gates.md`, plus:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test
pnpm --filter @langwatch/platform-api test:unit src/features/<f>/__tests__/<f>.composition.integration.test.ts
pnpm --filter @langwatch/<f>-server typecheck && pnpm --filter @langwatch/platform-api typecheck
```

## Report

The operations added with method, path and version; the permission for each; the
scenarios and the tests that bind them; whether the frozen OpenAPI document needs a human
diff; anything left absent by design.
