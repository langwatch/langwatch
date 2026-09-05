# The tRPC fluent chain in `@langwatch/api`

Frozen 2026-09-05. Mirrors the REST chain (`createRestService`) on the tRPC side, so
every procedure declares its input, its output and its access the same way a route does.
Spec: `packages/api/specs/trpc-framework.feature`.

## Why

Today a feature writes the policy application by hand, inside a bare `router({})`:

```ts
return trpc.router({
  getProjectAPIKey: policy("project:update")(procedure.input(projectScopeSchema)).query(handler),
});
```

Three things are only conventions there: the policy has to be applied AFTER `.input()`
(before it, the authorization check reads `undefined`), the access declaration can be
forgotten entirely (only the runtime fail-closed backstop catches it), and nothing
states the response shape, so there is no source for response validation or for the
documentation the tRPC surface will grow.

## Shape

```
  createTrpcService({ root, procedures, validateOutput })
        │
        ├── .query("name",    p => p.withInput(S).withOutput(O).withPermission(D).handle(fn))
        ├── .mutation("name", p => p.withInput(S).withOutput(O).withPermission(D).handle(fn))
        │
        └── .build()  ─────────────────────────────►  root.router({ name: <procedure>, … })

  one procedure, inside the chain:

    procedures.protected                     the process's authenticated procedure
        │  .input(S)                         the feature's parser, FIRST
        ▼
    procedures.policy(D)( … )                tracer → logger → handledError →
        │                                    scopeLineage(D) → declaredCheck(D) →
        │                                    enforceCheck → auditMutations
        ▼
        .query(guard(O, fn))                 guard = fn, plus O.safeParse in dev/test
        │
        ▼
    TRPCQueryProcedure<{ input: z.input<S>; output: Awaited<ReturnType<fn>>; meta }>
```

The runtime output is identical to what a mount builds today, statement for statement:
the same procedure, the same parser, the same policy decorator in the same position, the
same `.query`/`.mutation` call. Audit redaction and call logging live in those
middlewares and are untouched.

## Before / after — one procedure

```ts
// before
getProjectAPIKey: policy("project:update")(procedure.input(projectScopeSchema)).query(
  async ({ input, ctx }) => {
    const project = await ctx.app.projects.tryGetById(input.projectId);
    if (!project) throw new ProjectNotFoundError();
    return project;
  },
),

// after
.query("getProjectAPIKey", (p) =>
  p
    .withInput(projectScopeSchema)
    .withOutput(projectSchema)
    .withPermission("project:update")
    .handle(async ({ input, ctx }) => {
      const project = await ctx.app.projects.tryGetById(input.projectId);
      if (!project) throw new ProjectNotFoundError();
      return project;
    }),
)
```

## Argument order: the chain is ONE argument, and the handler is inside it

The brief proposed `.query(name, handler, define)`. That order cannot be typed:
TypeScript fixes an argument's inferred types in source order, so a handler written
before the chain that declares its input parser is checked while the input type
variable is still unresolved, and `input` lands as `unknown`. Verified with a probe —
`q(name, ({input}) => input, c => c.withInput<{x:number}>(…))` infers `unknown`;
`q(name, c => c.withInput<{x:number}>(…), ({input}) => input)` infers `{x:number}`.
REST lives with that (its docs tell authors to annotate the handler parameter) because
its handler takes a Hono context. A tRPC handler's whole argument is derived from the
parser, so losing it would be a real regression over `procedure.input(S).query(fn)`.
So the chain terminates in `.handle(fn)`, exactly like the REST endpoint chain, and
`fn`'s `{ ctx, input }` is typed from the schema the chain already carries.

## The type-state

`RestEndpoint`'s pattern, four flags on one interface:

| Declared by | Flag | Missing means |
| --- | --- | --- |
| `withInput(S)` / `withoutInput(reason)` | `TInput` | `handle` is `never` |
| `withOutput(S)` / `withoutOutput(reason)` | `TOutput` | `handle` is `never` |
| `withPermission(access)` / `withCustomPermission(policy, reason)` | `TDeclared` | `handle` is `never` |

```ts
handle<TResult>(
  this: TDeclared extends true
    ? TInput extends ChainInput ? TOutput extends ChainOutput ? Chain<…> : never : never
    : never,
  handler: (opts: { ctx: TContext; input: InputOf<TInput> }) => TResult,
): CompletedChain<TInput, TResult>;
```

A procedure that never declares its access has no callable `handle`: `error TS2684 —
the 'this' context of type … is not assignable to method's 'this' of type 'never'`.
The process's fail-closed `enforceCheck` backstop stays where it is; it becomes the
second line rather than the first.

Access is AuthZ vocabulary only. `withPermission` takes an `AuthzPermission` or a whole
`AuthzDeclaration` (`permission`, `permission-any`, `no-permission`,
`service-authorized`) and hands it straight to `procedures.policy`, which is the
existing `declaredPolicy`. There is no role enum, no `TeamRoleGroup`, no
`checkUserPermission*` anywhere in a transport file; a procedure whose gate is data the
handler loads declares `service-authorized` and says what enforces it.
`withCustomPermission` is for the two shapes the process builds itself (a check that
resolves its tier from validated input); it takes the process's ALREADY-BUILT policy
decorator plus a written reason, so it is as reviewable as a declaration.

## Output schemas — new information, not a new client type

`withOutput` never reaches tRPC's `.output()`. If it did, the client's inferred output
would become `z.output<S>` and every consumer's types would shift. Instead the chain
wraps the handler: in test and development (`validateOutput`, supplied by the process —
this package reads no environment) the result is `safeParse`d and a mismatch throws with
the procedure name and the issue path; the value returned is always the handler's own,
unparsed, so nothing is stripped or coerced. The schema is therefore two things: a
runtime guard where a mistake is cheap to find, and the one machine-readable statement
of what a procedure answers — the source an SDK or an OpenAPI-style document for the
tRPC surface will read.

`withoutOutput(reason)` exists for the procedures whose answer is not the feature's to
describe (`integrationsChecks.getCheckStatus` returns the process's own rollup, generic
in the feature). It satisfies the type-state and records why, the way
`withoutPermission(reason)` does on the REST side.

## The client's types stay identical

The builder accumulates a procedure record typed as tRPC types it:
`TRPCQueryProcedure<{ input; output; meta }>` / `TRPCMutationProcedure<…>`, with
`input = z.input<S>` (or `void` for `withoutInput`), `output = Awaited<TResult>` and
`meta` the root's. `.build()` calls `root.router(record)`, so `AppRouter` is built by
the same factory as before. This is pinned by a type test that asserts, with a mutual
`extends` `Equal<>`, that a chain-built router type and the hand-written
`router({ x: policy(p)(procedure.input(S)).query(fn) })` type are the same type — not
merely assignable. `apps/ui` typechecks against the real router as the second proof.

## What is NOT in the chain yet

`.subscription(...)` — the SSE/subscription procedures in `apps/api/src/app-trpc` still
build directly. A lane that converts them extends the chain with a scenario first.

## Enforcement

`api-transport-through-framework` (`packages/architecture-lint`) refuses, in a
`transport/api-trpc/*.api.ts` file, a bare `router({ … })`, a `.input(` outside the
chain and an `initTRPC` import; in a `transport/api-rest/*.api.ts` file, `describeRoute`
/ `validator` / `resolver` from `hono-openapi`, `@hono/zod-validator`, and
`new Hono` / `OpenAPIHono`; and in either, the legacy RBAC identifiers. Not-yet-converted
files sit in a checked-in allowlist that only shrinks: an entry naming a file that no
longer violates is itself a violation, so a conversion that leaves its line behind fails.
