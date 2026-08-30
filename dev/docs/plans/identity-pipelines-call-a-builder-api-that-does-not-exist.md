# The four identity pipelines call a `definePipeline` head that was never built

**RESOLVED** in "Build the four identity pipelines the way every working
pipeline builds" — resolution (2) below, the config form. All four construct;
the package suite went from 20 failed / 18 passed to 3 failed / 35 passed. The
rest of this page is kept because it records what the two options cost, which
is the part that is expensive to rediscover.

Resolution (2) won on a rule, not a preference: it needed no new builder
surface, and (1) would have meant inventing one and deciding where a
pipeline's event list comes from. The five `.withProjection(NAME, instance)`
calls went the same way — `withPostgresProjection(definition)` takes one
argument because an `AbstractFoldProjection` already carries its own `name`.
Each of the five name arguments was checked against the class's own
`readonly name` before being dropped: a projection's name is its cursor key,
so a mismatch would have silently repointed a cursor. All five agreed.

Still open, and untouched by this: the zod split described at the bottom.

## The fact

```
$ tsx -e 'createIdentityPipeline({})'
RESULT: THREW -> Cannot destructure property 'name' of 'config' as it is undefined.
```

`packages/identity-eventing`'s four pipelines — `identity`, `join-requests`,
`scim-sync`, `sso-connections` — all open the same way:

```ts
definePipeline<IdentityEvent | MfaEvent>()
  .withName(IDENTITY_PIPELINE_NAME)
  .withAggregateType(USER_IDENTITY_AGGREGATE_TYPE)
```

`definePipeline` has two overloads and both require a `{ name, aggregate }`
config. `withName` and `withAggregateType` appear nowhere in
`packages/eventing`. Everything further down each chain — `withProjection`,
`withCommandInstance`, `build` — does exist, so only the head is wrong.

## Why it matters more than a red test

`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`
calls `createIdentityPipeline(...)` directly inside `registerAll()`, and
`registerAll()` is called ungated from the composition root
(`presets.ts:2403`). Composing the App therefore throws.

The registration's own comment says the pipeline "ships dark: no production
writer dispatches these commands". That is true of *dispatch* and says nothing
about *registration* — the pipeline is still constructed, and construction is
what fails.

It also fails 20 of the package's 38 tests, which is how it surfaced.

## Not a regression from main

`definePipeline`, `packages/identity-eventing`, and all four pipelines are new
on this branch — main has `packages/identity` and no `definePipeline` at all.
This is in-flight work whose two halves disagree, not something that broke.

## The fork

1. **Give the builder the fluent head the pipelines expect.** Four files were
   written this way deliberately; one typo does not repeat four times. But
   `withAggregateType` takes a type *string* while the config takes an
   `AggregateDefinition`, so the builder would have to construct one — which
   means deciding where a pipeline's event list comes from.
2. **Convert the four pipelines to the config form**, which is what the rest of
   the repo already does — `ingestion-pull`, `pulled-usage` and
   `governance-events` all call `definePipeline<T>({ name, aggregate:
   defineAggregate({ type, events: defineEvents(TYPES) }) })` and work. Every
   ingredient exists for identity too: `defineAggregate`, `defineEvents`,
   `USER_IDENTITY_AGGREGATE_TYPE`, `IDENTITY_EVENT_TYPES`, `MFA_EVENT_TYPES`.

(2) follows the working precedent and needs no new builder surface. (1) is
what the four files' author appears to have intended. It is not a test author's
call, so it is written down rather than guessed.

## While you are there

The same package has 37 type errors from the zod split — its command schemas
come from `@langwatch/identity-contract`, pinned to zod 3, and go to
`@langwatch/eventing`, on zod 4. See
[zod-4-migration-misses.md](zod-4-migration-misses.md). Those are independent
of this and will not be fixed by either resolution above.
