# 006: A tRPC procedure declares its input, output and access on a chain

**Date:** 2026-09-05

**Status:** Accepted; governed handler rules amended by
[ADR-133](../../../../dev/docs/adr/133-composition-spec.md).

The original raw `{ ctx, input }` handler, `withoutInput`/`withoutOutput`, custom
policy decorators and optional output parsing described below are legacy
migration forms. ADR-133 requires explicit input/output schemas, framework
policy binding, restricted handler arguments and runtime parsing of every
output. Feature-owned declarations continue to use the fluent API chain.

## Context

A feature used to write the policy application by hand, inside a bare
`router({})`:

```ts
return trpc.router({
  getProjectAPIKey: policy("project:update")(procedure.input(projectScopeSchema)).query(handler),
});
```

Three things there are conventions only. The policy has to be applied after
`.input()`, because before it the authorization check reads `undefined`. The
access declaration can be forgotten entirely, and only the runtime fail-closed
backstop catches that. Nothing states the response shape, so there is no source
for response validation or for documentation. Spec:
`packages/api/specs/trpc-framework.feature`.

## Decision

Mirror the REST chain on the tRPC side.

```
  createTrpcService({ root, procedures, validateOutput })
        │
        ├── .query("name",    p => p.withInput(S).withOutput(O).withPermission(D).handle(fn))
        ├── .mutation("name", p => p.withInput(S).withOutput(O).withPermission(D).handle(fn))
        │
        └── .build()  ──►  root.router({ name: <procedure>, … })
```

The runtime output is identical to what a mount builds today, statement for
statement: the same procedure, the same parser, the same policy decorator in the
same position, the same `.query` or `.mutation` call. Audit redaction and call
logging stay in those middlewares.

**The chain is one argument, and the handler is inside it.** TypeScript fixes an
argument's inferred types in source order, so a handler written before the chain
that declares its parser is checked while the input type variable is still
unresolved, and `input` lands as `unknown`. Verified with a probe. So the chain
terminates in `.handle(fn)`, and `fn`'s `{ ctx, input }` is typed from the
schema the chain already carries.

**A missing declaration makes `handle` uncallable.** Three flags on one
interface, in the `RestEndpoint` pattern: `withInput` or `withoutInput(reason)`,
`withOutput` or `withoutOutput(reason)`, and `withPermission` or
`withCustomPermission(policy, reason)`. A procedure that never declares its
access gets `error TS2684`. The process's fail-closed backstop stays where it
is; it becomes the second line rather than the first.

**Access is AuthZ vocabulary only.** `withPermission` takes an
`AuthzPermission` or a whole `AuthzDeclaration` and hands it to the existing
declared policy. There is no role enum and no legacy RBAC identifier in a
transport file. A procedure whose gate is data the handler loads declares
`service-authorized` and says what enforces it. `withCustomPermission` takes an
already-built policy decorator plus a written reason, for the two shapes the
process builds itself.

**`withOutput` never reaches tRPC's `.output()`.** If it did, the client's
inferred output would become `z.output<S>` and every consumer's types would
shift. The chain wraps the handler instead: in test and development the result
is `safeParse`d and a mismatch throws with the procedure name and the issue
path, and the value returned is always the handler's own, unparsed. The schema
is therefore two things: a runtime guard where a mistake is cheap to find, and
the one machine-readable statement of what a procedure answers.
`validateOutput` is supplied by the process, because this package reads no
environment.

**The client's types stay identical.** The builder accumulates a procedure
record typed as tRPC types it, and `.build()` calls `root.router(record)`. A
type test asserts with a mutual `extends` that a chain-built router type and the
hand-written type are the same type, not merely assignable. `apps/ui`
typechecking against the real router is the second proof.

## Consequences

`api-transport-through-framework` refuses a bare `router({ … })`, an `.input(`
outside the chain and an `initTRPC` import in a `transport/api-trpc/*.api.ts`
file. Not-yet-converted files sit in a checked-in allowlist that only shrinks:
an entry naming a file that no longer violates is itself a violation.

`.subscription(...)` is not in the chain yet. The SSE procedures in
`apps/api/src/app-trpc` still build directly. A lane that converts them extends
the chain with a scenario first.

## References

- [tRPC framework boundary](./20260828-trpc-framework-boundary.md)
- [The REST chain extensions](./005-rest-chain-extensions.md)
- [ADR-128: Public REST and internal tRPC](../../../dev/docs/adr/128-public-rest-and-internal-trpc.md)
