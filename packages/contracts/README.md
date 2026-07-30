# @langwatch/contracts

Wire contracts shared across LangWatch surfaces: Zod schemas, and the
TypeScript types inferred from them.

Schemas only — no transport, no Prisma, no environment, no runtime
dependencies beyond a `zod` peer. That constraint is what lets the same file
describe the server's validation and a client's expectations without dragging
the server into the client.

## Layout

One directory per wire surface, one subpath export each:

```
src/agent-onboarding/   → @langwatch/contracts/agent-onboarding
```

Import the subpath, not the root, unless you genuinely need several surfaces.
A root import pulls every surface into the consumer's module graph, so adding
a second one would grow the bundle of a consumer that never asked for it.

## Rules

- **Zod is the single source of truth.** Declare the schema, `z.infer` the
  type. Never hand-write an interface next to a schema that already implies it.
- **Nothing environment-specific.** No `process.env`, no Node built-ins, no
  Prisma types. If a contract needs a value that only the server knows, the
  server puts it *on the wire* — see `lifecycleNoticeSchema`, where the copy is
  server-rendered because the deadlines are deployment configuration.
- **Absolute timestamps, not durations.** Clients persist these and read them
  back later.
- **Closed enums over free strings** for anything that reaches storage or
  provenance.

## Adding a surface

1. `src/<surface>/` with the schemas split by endpoint group.
2. `src/<surface>/index.ts` re-exporting them.
3. A subpath entry in `package.json#exports`.
4. A namespace re-export in `src/index.ts`.

## Testing

```bash
pnpm --filter @langwatch/contracts test:unit
```

Test the *rules* a schema encodes — that an unknown agent slug is rejected,
that a `plain` PKCE method is refused — never that a constant equals itself.
