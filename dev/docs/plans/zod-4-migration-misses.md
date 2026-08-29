# What the zod 4 upgrade broke quietly

`main` is on `zod@^3.25`; this branch is on `zod@^4.4`. Most of that upgrade is
covered by the type checker. The cases below are not: they are places where a
zod 3 API still *type-checks* — because it is reached through `unknown`, a
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
