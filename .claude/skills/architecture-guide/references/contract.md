# Contract packages

`packages/features/<name>/contract` is `@langwatch/<name>-contract`. It is the only
part of a feature that other features, the server half and the web half may all import,
so it carries what exists and what can go wrong, never how anything is done.

## What may live in `contract/src`

```
index.ts
<subject>.service.ts     abstract capability, at least one is required
<subject>.commands.ts    write inputs (zod)
<subject>.queries.ts     read inputs and outputs (zod)
<subject>.events.ts      domain events
<subject>.errors.ts      HandledError subclasses with stable codes
<domain files or domain directories>   e.g. secret.ts, simulation.ts, visualization/
```

Allowed artifact suffixes: `commands | errors | events | queries | service`. A server
artifact suffix in contract source (`adapter, api, mapper, migration, port, projection,
repository, store`) fails `feature-source-layout`. A bare `service.ts` with no subject
fails too: the file is `<subject>.service.ts`.

Contract must not import Node runtime APIs, Prisma, Hono, tRPC server code, React,
Eventing, application aliases, or its own server and web packages. It may import
`zod`, `@langwatch/handled-error`, and other features' contracts.

## Schemas once, types inferred

```ts
export const createSecretInputSchema = z.object({
  projectId: secretProjectIdSchema,
  name: z.string().min(1),
  value: secretValueSchema,
});
export type CreateSecretInput = z.infer<typeof createSecretInputSchema>;
```

When both validation and a type are needed, the schema is the source. Internal constants
with no external input use `as const`. Do not `.strict()` a schema that a producer you do
not control fills (the browser session schema went strict once and every signed-in
request parsed to null and read as anonymous). Use `z.input<typeof schema>` for wire
inputs whose fields carry defaults.

## Errors

```ts
export class SecretNotFoundError extends HandledError {
  constructor() {
    super("secret_not_found", "Secret not found.", { status: 404 });
  }
}
```

- Throw a `HandledError` only when the cause is known and the caller can act on it.
  Infrastructure failures stay plain `Error` and degrade to a generic failure with a
  trace id at the boundary.
- `code` is stable and sorted into `packages/handled-error/src/app-codes.ts`; the words
  a customer reads live in `packages/handled-error/src/presentation.ts`, keyed by code.
  A listed code with no presentation fails typecheck; a brand-new unlisted code is caught
  by `apps/ui/src/model/errors/__tests__/codes.unit.test.ts`.
- `message` is customer-safe: no env var names, hostnames or internal service names.
- A 5xx subclass sets `fault: "platform"` or `"provider"` explicitly.
- Tests assert on `code`, never on message prose.

## The abstract service

```ts
export abstract class SecretService {
  abstract getAll(input: ListSecretsInput): Promise<Secret[]>;
  abstract getById(input: { projectId: string; secretId: string }): Promise<Secret>;
  abstract create(input: CreateSecretInput & { actorId: string }): Promise<Secret>;
}
```

The server package implements it; a composition root constructs the concrete class and
injects it wherever another feature declares a dependency on the abstract one. Methods
return a value or throw the domain error. Only `try*` methods return `null`; `require*`
is forbidden. Parameters are named objects.

## The api-map: router types for the browser without importing the server

The web half never imports `apps/api`. It declares the procedures it calls as a map typed
from contract inputs and outputs, and `createFeatureApi` turns that into a tRPC React
client whose cache keys are the same as the application's:

```ts
// web/src/behavior/secret-api.ts
export type SecretApiMap = {
  secrets: {
    list:   { query:    { input: ListSecretsInput;  output: Secret[] } };
    create: { mutation: { input: CreateSecretInput; output: Secret } };
  };
};
export const secretApi = createFeatureApi<SecretApiMap>();
```

`createFeatureApi`, `FeatureApiMap`, `RouterFromMap` and the one named cast
`asFeatureApiClient` live in `packages/platform-api-client/src/feature-api.ts`. The
nesting is the cache key, so a hook in the package and the shell's proxy share one entry.
Never type a map slot as `any`; name the contract `*Output` type.

## Sharing across features

Feature B needs feature A's capability: B's server declares a port or takes A's abstract
service from `@langwatch/a-contract` in its `create({ ... })`, and the composition root
passes A's concrete service. B never imports `@langwatch/a-server`. If the shared thing
is a pure function or a value, it moves into A's contract, not into a shared `utils`.
