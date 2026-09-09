# Contract packages

`modules/<name>/contract` is `@langwatch/<name>-contract`. It is the only
part of a module that other modules, the server half and the web half may all import,
so it carries what exists, what can be asked, and what can go wrong, never how anything
is done. The reference is `modules/annotation/contract`.

## What may live in `contract/src`

```
index.ts
<name>.api.ts                  interface <Name>Api + export const <Name>Api = featureApi<<Name>Api>("<name>")   REQUIRED
<name>.schemas.ts              the domain value's zod schema(s) and inferred types
<name>-<part>.schemas.ts       one file per public shape family (queue, response, review, …)
<name>-rest.schemas.ts         params, query, body and response schemas of the REST door
<name>-trpc.schemas.ts         input schemas of the tRPC door
<name>.errors.ts · <name>-<part>.errors.ts     HandledError subclasses with stable codes
<name>-<part>.types.ts         portable types that are not schemas (inputs the app takes from peers)
<name>.ts                      constants and small portable values (ANNOTATION_KSUID_RESOURCE, anchor helpers)
```

Allowed artifact suffixes (`CONTRACT_ARTIFACT_SUFFIX`): `commands | errors | events |
queries | service` plus `api`; `schemas` and `types` are ordinary qualifiers the filename
grammar accepts. A server artifact suffix in contract source (`adapter, mapper, migration,
port, projection, repository, store`) fails `feature-source-layout`. A `<name>.service.ts`
(the old abstract service) is inventoried by `feature-shape` and is deleted when the
module converts; do not add one.

Contract must not import Node runtime APIs, Prisma, Hono, tRPC server code, React,
Eventing, application aliases, or its own server and web packages. It may import `zod`,
`@langwatch/handled-error`, `@langwatch/time`, `@langwatch/runtime-composition` (only
`featureApi`, `FeatureApiToken` and `FeatureName`), `@langwatch/api/contract` (only
`defineTrpcContract`) and other modules' contracts.

## The callable API and its token

```ts
// contract/src/annotation.api.ts
import { featureApi } from "@langwatch/runtime-composition";

export interface AnnotationApi {
  create(input: CreateAnnotationInput): Promise<Annotation>;
  getById(input: AnnotationByIdInput): Promise<Annotation>;
  list(input: ListAnnotationsInput): Promise<Annotation[]>;
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
  queueTraces(input: QueueAnnotationTracesInput): Promise<Readonly<{ created: number; skipped: number }>>;
}

export const AnnotationApi = featureApi<AnnotationApi>("annotation");
```

- One interface of callable operations. No service-valued properties, getters,
  repositories, transport objects or lookup methods (`feature-app-contract`).
- The same-named `const` is the runtime token. It is the only thing another module may
  depend on: the peer names it in its app's `static dependencies`, the process provides an
  implementation with `.withProvided(AnnotationApi, app)` or by installing the module,
  and boot rejects a missing, duplicate or cyclic provider by name.
- `featureApi` takes a `FeatureName`, the literal union generated from
  `modules/catalogue.json` (`packages/runtime-composition/src/feature-names.generated.ts`,
  regenerate with `node packages/runtime-composition/scripts/check-feature-names.mjs --write`).
  `featureApi("annotations")` does not compile.
- Operation names use RPC verbs: `get` for one known record, `getMany` for known ids,
  `list` for queries, `create`, `update`, `delete` for mutations; `<verb><Entity>` for
  a second entity (`listScores`, `upsertScore`, `markQueueItemDone`). A method returns a
  value or throws; absence is a `find*` method returning `undefined`, never `try*`
  (`fallible-result-naming` refuses the prefix on the API interface too, and a nullable
  result on anything not named `find*`).
- Parameters are one named object, typed from the contract's own schemas.

## Schemas once, types inferred

```ts
export const annotationScoreSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  dataType: z.enum(["OPTION", "CHECKBOX", "BOOLEAN", "LIKERT", "CATEGORICAL"]),
  createdAt: z.date(),
});
export type AnnotationScore = z.infer<typeof annotationScoreSchema>;
```

When both validation and a type are needed, the schema is the source; compose schemas
with `z.object({ ...base.shape, extra })`. Internal constants with no external input use
`as const`. Do not `.strict()` a schema that a producer you do not control fills; a REST
response that must keep passing through stored columns uses `z.looseObject(schema.shape)`
(see `annotation-rest.schemas.ts`). Use `z.output<typeof schema>` for inputs whose fields
carry defaults or transforms. Dates stay `z.date()` in contracts; services convert with
`@langwatch/time`.

## Errors

```ts
export class AnnotationNotFoundError extends HandledError {
  declare readonly code: "annotation_not_found";

  constructor(id: string) {
    super("annotation_not_found", `Annotation ${id} was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { annotationId: id },
    });
    this.name = "AnnotationNotFoundError";
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
- `fault` is explicit on every error; a 5xx sets `"platform"` or `"provider"`.
- `meta` is a client contract: only fields a UI or agent reads.
- Tests assert on `code`, never on message prose.
- A peer's error propagates as itself: the app does not wrap `ProjectNotFoundError`.

## Sharing across modules

Module B needs module A's capability: B's app names A's token in `static dependencies`
(`projects: ProjectApi`), the container hands B's `create(setup)` a `setup.dependencies.projects`
typed as `ProjectApi`, and B calls it. B never imports `@langwatch/a-server`, never
declares a port for A, and never takes A's service or repository. If the shared thing is
a pure function or a value, it moves into A's contract, not into a shared `utils`.

## The browser's api-map

The web half never names `AppRouter` (ADR-130) and writes no procedure map by hand. The
contract declares each tRPC procedure once in `<f>.trpc.ts` (or `<f>-<part>.trpc.ts`, one
file per namespace) with `defineTrpcContract("<namespace>")` from `@langwatch/api/contract`:
the wire name, `query`/`mutation`/`subscription`, `withInput(schema)` and, when it answers
data, `withOutput(schema)`. The browser derives its client from that declaration
(`ContractApiMap<typeof <f>Trpc>` in `web/src/behavior/<f>-api.ts`, see `references/web.md`),
and the server binds permission and handler to the same names. A contract `.trpc.ts` file
value-imports only `@langwatch/api/contract`, `zod` and its sibling schemas.
