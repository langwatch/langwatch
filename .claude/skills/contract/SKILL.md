---
name: contract
description: "Write or change a module's contract package (modules/<name>/contract): the `*Api` interface and moduleApi token, Zod schemas with z.infer, HandledError subclasses and their codes, the tRPC declarations (defineTrpcContract), REST wire schemas, method verbs (get/find/list, ADR-146). Use when someone says 'add an Api operation', 'new *Api method', 'add a schema', 'add an error code', 'HandledError', 'new tRPC procedure', 'declare a procedure', 'contract package', 'what verb should this method use', 'T | null return', or opens modules/*/contract/src."
user-invocable: true
---

# A contract

Record: `dev/docs/ARCHITECTURE.md` §3.1 (the contract), §8 (transports), §12
(errors), `dev/docs/adr/146-method-verb-vocabulary.md` (verbs). Exemplars:
`modules/monitor/contract` (small), `modules/organization/contract` (large),
`modules/automation/contract`.

The contract is **everything another module or a browser may know** about you:
schemas, portable types, errors, the tRPC declarations, the `*Api` interface.
It imports no framework runtime and no other half (see the `module` skill).

## What lives in `contract/src/`

| File | Holds | Example |
|---|---|---|
| `<name>.ts`, `<concern>.ts` | Zod schemas plus `z.infer` types | `monitor/contract/src/monitor.ts` |
| `<name>.api.ts` | the `*Api` interface and its token | `monitor.api.ts` |
| `<name>.errors.ts` | `HandledError` subclasses | `monitor.errors.ts` |
| `<name>.trpc.ts` | `defineTrpcContract` declarations | `monitor.trpc.ts` |
| `<name>-trpc.schemas.ts` | tRPC input and answer schemas | `monitor-trpc.schemas.ts` |
| `<name>-rest.schemas.ts` | REST wire schemas, distinct from domain | `monitor-rest.schemas.ts` |
| `<name>.events.ts`, `.commands.ts`, `.queries.ts` | eventing vocabulary | `automation.events.ts` |
| `<name>.config.ts` | the module's config schema (§6) | `automation.config.ts` |
| `index.ts` | `export *` of the above | `monitor/contract/src/index.ts` |

The filename grammar is `packages/oxlint-rules/grammar/feature-layout-policy.mjs`
(contract suffixes: `app`, `commands`, `errors`, `events`, `queries`,
`service`; `<feature>.api.ts` is the one home of the token). A process-only
suffix (`.repository`, `.channel`, `.rules`...) in a contract is refused.

## Rules that matter

1. **Zod, then `infer`.** Declare the schema, derive the type:
   `export type Monitor = z.infer<typeof monitorSchema>`. Never write a TS type
   that restates a schema or another contract's type (CLAUDE.md rule 5).
2. **One options object per operation.** `create(input: MonitorCreateInput)`,
   `findBySlug({ projectId, slug })`. Never positional (`max-params`, §3.2).
   Named parameters carry `projectId`, and the caller's `authorization`
   travels as a parameter, never ambient (§3.2, ADR-166).
3. **Verbs are ADR-146's.** `get*` returns exactly one or throws the module's
   not-found error. `find*` returns an array (empty is absence). `list*`
   returns a page `{ items, cursor }`. Writes: `create`, `update`, `delete`,
   `upsert`, `archive`. No `T | null`, no `try*`, no `resolve*`.
   `MonitorApi` shows the pair: `getById` throws, `findBySlug` returns an
   array.
4. **The token is one line.**
   `export const MonitorApi = moduleApi<MonitorApi>()("monitor");` Interface
   and const share a name. The string is the module id.
5. **A tRPC procedure is declared once, here.**
   `defineTrpcContract("monitors").query("getById").withInput(s).withOutput(s)`.
   The process binds permission and handler; the browser derives its client
   from the same declaration (§8). The procedure name is the browser's cache
   key: renaming or changing kind (query vs mutation) moves the call.
6. **Every wire schema is imported from the contract**, never redefined in a
   transport (§8). REST wire schemas stay distinct from domain schemas.
7. **A known failure is a `HandledError` subclass with a stable code**
   (§12). `message` is customer-safe. Tests assert the `code`, not prose.
   A ported code keeps main's spelling. A 5xx sets `fault` explicitly.
8. **A new `*Api` operation is a design choice.** Ask first, unless it is a
   one-to-one port of logic main kept in a handler (§8: pre-approved).
9. **Contract `package.json` names no runtime**: no `prisma-client`,
   `clickhouse-client`, `redis-client`, `eventing`, `group-queue`, `process-*`
   (§3; the `manifests` policy refuses it).

## Worked example: an error and its code

`modules/monitor/contract/src/monitor.errors.ts` (reformatted):

```ts
export class MonitorNotFoundError extends HandledError {
  declare readonly code: "monitor_not_found";
  constructor(readonly monitorId: string) {
    super("monitor_not_found", "Monitor not found.", {
      httpStatus: 404, fault: "customer", meta: { monitorId },
      ...remediation("monitor_not_found"),
    });
    this.name = "MonitorNotFoundError";
  }
}
```

Then add the code to the registry (customer copy, tips) in
`packages/handled-error/src/remediation.ts`. `remediation("<code>")` is typed
over that registry, so an unregistered code does not compile. A 404 can also
extend `NotFoundError` (`organization/contract/src/team.errors.ts`).
Presentation copy: `dev/docs/best_practices/error-handling.md`.

## Worked example: an operation, end to end

Adding a hypothetical `monitor.archive` (not in the tree):

1. Schema `monitorArchiveInputSchema` in `monitor-trpc.schemas.ts` or
   `monitor.ts`, with `export type ... = z.infer<...>`.
2. `archive(input: MonitorArchiveInput): Promise<Monitor>` on `MonitorApi`
   (`monitor.api.ts`), with a one-line doc comment.
3. If it has a route: a `.mutation("archive")` in `monitor.trpc.ts`.
4. Implement it in the process half (`process-module` skill). The token
   already exists; nothing else registers the operation.
5. Specs: a scenario in `modules/monitor/specs/` first.

## Traps

- **Restating a type** from another contract. Import it
  (`@langwatch/evaluation-contract`) and name it.
- **Returning `T | null`** or `Promise<X | undefined>` from a lookup. A keyed
  read that may miss is a `get*` that throws; the caller catches the `code`.
- **Putting a transport's permission list in the contract.** Permissions are
  bound in `process/src/transport/<name>.trpc.ts` (§8).
- **Re-parsing.** Parse once where a value enters untyped (a transport, a
  channel's inbound message); it travels as its `z.infer` type afterwards (§3.2).
- **Config and peer-dependency declarations** (the `<name>.config.ts` slice,
  what the module demands of its process) are the future `module-dependencies`
  skill. A contract may only carry the schema; do not invent supply tokens here.
- **A hand-written client or router type.** The browser client derives from the
  declarations (`@langwatch/api/web`), never a router type (§3.4).
- **Naming from the §15 list.** Look there before inventing any helper name.
