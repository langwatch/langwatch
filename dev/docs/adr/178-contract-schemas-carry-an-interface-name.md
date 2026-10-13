# ADR-178: Contract schemas carry an interface name

**Date:** 2026-10-10

**Status:** Accepted (Alex, 2026-10-10)

**Builds on:** ADR-099 (TypeScript 7 is the compiler), ADR-100 (TypeScript
performance measurements), ADR-135 (lint and format toolchain).

> One-line: every exported composite Zod schema in a contract is declared as a
> private definition, an interface that names its type, and the export typed by
> that interface. Emitted declarations then print the name, not the whole tree.

## Context

TypeScript prints an inferred type in full wherever a declaration file needs
it. A Zod schema's type is an anonymous `ZodObject<{ id: ZodString; ... }>`
tree, so every tRPC member, derived schema and response that uses a schema
repeats it. Contracts emitted declarations 20 to 540 times their source size
(`agent.trpc.d.ts` 369 KB from 61 lines), and almost any edit to a shared
schema changed every downstream declaration, so dependants rebuilt.

Measured on the agent contract (2026-10-10):

| Shape                                                | `agent.trpc.d.ts` |
| ---------------------------------------------------- | ----------------- |
| today (inferred)                                     | 369 KB            |
| erased to `z.ZodType<Output, Input>`                 | 696 KB            |
| two schemas named with an interface                  | 54 KB             |
| `isolatedDeclarations` (every shape written by hand) | ~600 errors       |

An interface is always printed by name. A type alias of an inferred type is
not, and erasing to `ZodType` prints the data shape four times.
`isolatedDeclarations` would mean writing every shape twice, against the rule
that types come from `z.infer`.

## Decision

1. An exported schema built from `z.object`, `z.union`, `z.discriminatedUnion`,
   `z.intersection`, `z.array`, `z.record`, `z.tuple` and their kin, or derived
   from another schema (`fooSchema.extend(...)`), is written as:

   ```ts
   const agentSchemaDefinition = z.object({ ... });
   export interface AgentSchema extends Named<typeof agentSchemaDefinition> {}
   export const agentSchema: AgentSchema = agentSchemaDefinition;
   ```

   `Named<T>` is the identity type from `@langwatch/module` (an interface
   cannot extend `typeof x` directly). No field is written twice; `z.infer`,
   `.extend`, `.pick` and discriminated unions work unchanged.

2. The interface is the constant's name in PascalCase. When a type of that name
   already exists (the schema shares its name with its inferred type), it takes
   a `Schema` suffix.

3. Primitive schemas (`z.string().min(1)`, `z.enum([...])`), recursive ones
   (`z.lazy`, a getter naming itself) and already-annotated constants stay as
   they are.

4. The rule below enforces it and carries the fix: `pnpm exec oxlint --fix`
   rewrites a file. It is the only `langwatch/*` rule meant to be fixed by the
   tool rather than by hand.

| Rule                              | Layer  | Meaning                                                                                         |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `langwatch/contract-schema-named` | plugin | An exported composite Zod schema in a contract is typed by an interface, so emit prints a name. |

## Consequences

- Contract declarations shrink and stop churning: a field added to a schema
  changes its own declaration, not every member that names it.
- Two extra lines per schema. The fixer writes them, so the cost is review, not
  authorship.
- A barrel that re-exports a schema by name re-exports its interface too
  (`planSchema, type PlanSchema`); otherwise a dependant's declarations cannot
  name it and TypeScript refuses with TS2883.
- Contract files copied verbatim into the published SDK
  (`sdks/typescript/copy-types.sh`) get a local `type Named<T> = T` in place of
  the import, and the langevals generator (`generate_evaluators_ts.py`) writes
  the named form itself.
- Schemas outside contracts are not governed yet; process and browser packages
  are read by their own module only.
