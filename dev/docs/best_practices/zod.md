# Zod

The repository is on zod 4. Two identity packages still resolve zod 3, so both
majors are installed at once. Most of the difference is covered by the type
checker. What follows is the part that is not.

## Never inspect a schema you did not build

Code that reaches past `.parse()` and `.safeParse()` into a schema's internals
type-checks under both majors and answers wrong under one of them. Two real
cases:

- **`.innerType()` on a refined object throws at module load.** Zod 3 wrapped
  `z.object({…}).superRefine(…)` in a `ZodEffects`, and `.innerType()` unwrapped
  it. Zod 4 refines in place, so the method does not exist. A call at module
  scope took down every module that imported the file. The fix is to name the
  un-refined object in the contract and build the refined schema from it, so a
  caller that needs `.extend()` starts from an object.
- **A shape reader that knows only zod 3's spellings answers `{}`.** A helper
  looked for `_def.schema` and an `innerType()` method. Under zod 4 the refined
  case falls through to plain `shape` and still works, which is why nothing
  looked broken, but a wrapped schema answers `.unwrap()` or `_def.innerType`
  and neither was read.

Where to look for more: any `_def` access, any `instanceof ZodX`, any
`typeof s.someMethod === "function"` guard (these now simply never fire rather
than failing loudly), and issue `code` values. `z.record(constrainedKey, …)` now
reports `invalid_key` wrapping the real issue, and `flatten()` reads only the
outer message. See the record-key section of `error-handling.md`.

## A test for schema-inspecting code must use real schemas

Both cases above had tests, and both suites stayed green. Every case built an
object literal shaped the way zod 3 shaped its schemas:

```ts
const schema = { innerType: () => ({ shape: { GROQ_API_KEY: {} } }) };
```

That asserts the walking logic, which is worth doing. A literal cannot notice
zod moving the inner schema. **A test for code that inspects a library's data
structures has to get those structures from the library.** A stand-in tests your
reading of the library on the day you wrote it.

## The dual-major boundary

A zod 3 `ZodError` is not an instance of zod 4's class. Measured, not reasoned
about. The tRPC error formatter survives that because it tests `isZodLikeError`
structurally (an `issues` array and a `flatten` method) and converts with
`ValidationError.fromZodError`. Both majors satisfy both.

**That structural check is load-bearing.** Replacing it with
`instanceof z.ZodError` turns every identity validation failure into an unknown
500. Use a structural check at any boundary that can receive a schema or an
error it did not itself create.

Errors cross the boundary safely. Schemas do not, and nothing can make them:
a schema is handed to a library that reads its internals. Zod 3's
`ZodEffects<…>` is not assignable to zod 4's `ZodType<…>`, so a zod 4 package
that imports a schema from a zod 3 package does not compile against it. Expect
that wherever the boundary is crossed. The durable fix is one zod.
