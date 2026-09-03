# What the zod 4 upgrade broke quietly

`main` is on `zod@^3.25`; this branch is on `zod@^4.4`. Most of that upgrade is
covered by the type checker. The cases below are not: they are places where a
zod 3 API still _type-checks_ — because it is reached through `unknown`, a
structural cast, or a runtime `typeof` guard — and fails or silently answers
wrong at run time.

They are collected because they share a shape, not because they are related by
feature. Expect more of them wherever a schema is inspected rather than parsed.

## The two found so far

### `.innerType()` on a refined object — a TypeError at module load

Zod 3 wrapped `z.object({…}).superRefine(…)` in a `ZodEffects`, and
`.innerType()` unwrapped it. Zod 4 refines in place, so the method does not
exist.

`experiments-v3/actions/schemas.ts` called it at module scope, so the throw
took down every module that imported it: every action transform, the action
manifest, and the Langy UI-action backend executor. Two suites reported it as
"cannot load".

Fixed by naming the un-refined object in the contract
(`targetConfigObjectSchema`) and building `targetConfigSchema` from it, so a
caller that needs to `.extend()` starts from an object rather than unwrapping
a wrapper that is no longer there.

### `getSchemaShape` reading only zod 3's spellings — an empty answer

The helper finds a provider's credential field names, and its docblock says
the alternative is that a provider "silently reports no credential keys at
all". It looked for `_def.schema` (zod 3's refined object) and an
`innerType()` **method** (zod 3's wrapper).

Under zod 4 the refined case falls through to plain `shape` and still works —
which is why nothing looked broken. But a wrapper answers `.unwrap()` or
`_def.innerType`, and neither was read, so `.optional()` returned `{}`.

Latent, because no provider wraps its `keysSchema` today. Fixed anyway: a
guard that has stopped guarding is not worth the two lines it saves.

## Why neither was caught

Both are inspected-schema code, and both had tests.

`getSchemaShape`'s tests are the instructive ones. Every case built an object
literal shaped the way zod 3 shaped its schemas:

```ts
const schema = { innerType: () => ({ shape: { GROQ_API_KEY: {} } }) };
```

That asserts the walking logic, which is worth doing — but a literal cannot
notice zod moving the inner schema, so the suite stayed green through a change
that made the function answer nothing. The fix adds cases driven by schemas
zod actually builds; four of them fail against the implementation they
replaced.

**The rule: a test for code that inspects a library's data structures has to
get those structures from the library.** A stand-in tests your reading of the
library on the day you wrote it.

## Where to look for more

Anything that reaches past `.parse()` / `.safeParse()` into a schema's
internals:

- `_def` access of any kind — the whole shape of `_def` changed;
- `instanceof ZodX` — see [[zod-dual-major-boundary-trap]], where an
  `instanceof ZodError` across a major boundary silently 500s;
- `typeof s.someMethod === "function"` guards, which now simply never fire
  rather than failing loudly;
- issue `code` values, which is a third variant: `z.record(constrainedKey, …)`
  now reports `invalid_key` wrapping the real issue, and `flatten()` reads
  only the outer message. See the record-key section in
  `dev/docs/best_practices/error-handling.md`.

## Both majors are installed, and the boundary is (currently) safe

`pnpm` resolves two zods in this workspace:

| what                                                         | zod     |
| ------------------------------------------------------------ | ------- |
| `platform/app`, and 113 other package manifests              | 4.4.3   |
| `@langwatch/identity-contract`, `@langwatch/identity-server` | 3.25.76 |

Ten files in the identity packages import zod, so identity really does produce
**zod 3** errors that travel into zod 4 code. Measured rather than reasoned
about:

```
zod4: instanceof z4.ZodError = false→true | fromZodError -> validation_error
zod3: instanceof z4.ZodError = FALSE      | fromZodError -> validation_error
```

So the trap is live — a zod 3 `ZodError` is not an instance of zod 4's class —
and the boundary survives it anyway, because the tRPC error formatter tests
`isZodLikeError` (structurally: an `issues` array and a `flatten` method) and
converts with `ValidationError.fromZodError`. Both majors satisfy both.

**This is load-bearing and unenforced.** Replacing that structural check with
`instanceof z.ZodError` would turn every identity validation failure into an
unknown 500 — the failure mode has been seen before. `anomalyRules.ts` says as
much in a comment at its own boundary.

The `instanceof` uses that remain (`governance/aiTools.ts`,
`routes/evaluations-legacy.ts`) are safe today for a boring reason: they parse
with `platform/app`'s own zod 4 and catch the error a line later, so no
boundary is crossed. They stop being safe the moment a schema arrives from
somewhere else.

The durable fix is one zod. Until then, `isZodLikeError` at any boundary that
can receive a schema or an error it did not itself create.

## The dual-major boundary is not only a runtime risk — it is 37 type errors

`@langwatch/identity-eventing` does not typecheck, and the dominant reason is
the split recorded above.

It resolves zod 4.4.3, as does `@langwatch/eventing`. But it imports its command
schemas from `@langwatch/identity-contract`, which is pinned to 3.25.76, and
hands them to `eventing`'s pipeline API. Zod 3's `ZodEffects<…>` is not
assignable to zod 4's `ZodType<…, $ZodTypeInternals<…>>`, so every command
registration is rejected:

```
Type 'ZodEffects<ZodObject<…>>' is missing the following properties from type
'ZodType<unknown, unknown, $ZodTypeInternals<unknown, unknown>>':
_zod, def, type, toJSONSchema, and 18 more.
```

Thirty-seven of those, across `identity/commands/`, `join-requests/commands/`,
`scim-sync/commands/` and `sso-connections/commands/`.

So the two identity packages being on zod 3 is not a private choice. Any
package on zod 4 that consumes a schema they export cannot compile against it.
The `isZodLikeError` structural check keeps _errors_ crossing the boundary
safely; nothing does the same for _schemas_, and nothing can — a schema is
handed to a library that reads its internals.

The fix is one zod. Until then, expect this wherever a zod-4 package imports a
schema from `identity-contract` or `identity-server`.

## The rest of identity-eventing's 65

Two other groups, unrelated to zod:

- **`definePipeline` is called with an API that does not exist.** Four
  pipelines (`identity`, `join-requests`, `scim-sync`, `sso-connections`) call
  `definePipeline<T>()` with no argument and chain `.withName(...)`
  / `.withAggregateType(...)`. Both of `definePipeline`'s overloads require a
  `{ name, aggregate }` config, and `withName` and `withAggregateType` appear
  nowhere in `packages/eventing`. TS2554 and TS2339 say so; at run time it is
  `Cannot destructure property 'name' of 'config' as it is undefined`, which is
  what fails 20 of the package's 38 tests.

  All four are registered in
  `platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`,
  so this is worth tracing to whether the registry reaches them at boot before
  assuming it is only a test problem.

- **`TS2422` (5) and `TS2344` (10)**, in the fold projections and command
  files, which are likely downstream of the same two causes.

None of this is a loop-tick repair. It is the identity platform wave's own
work — see [[identity-platform-wave1-state]] and [[identity-wave2-spike]].
