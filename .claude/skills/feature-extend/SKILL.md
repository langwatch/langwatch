---
name: feature-extend
description: "Add or change one capability in an existing LangWatch feature package end to end: a new command or query, a new field, a new tRPC procedure or REST route, a new screen section or drawer, a new failure mode. Walks contract → server (service, repository, transport) → composition → web (behavior, section, screen) with the spec scenario written first and every layer kept inside the strict layout grammar. Use this whenever someone asks to add an endpoint, a mutation, a column, a filter, a button that does something new, a validation, an error message, or 'make <feature> also do X', and the subject already has a package under packages/features or packages/enterprise/features."
user-invocable: true
argument-hint: "<feature> <what to add, e.g. 'archive a secret'>"
---

# Extend a feature

Read `.claude/skills/architecture-guide/SKILL.md` and the reference for each layer you
touch. The point of this skill is that one capability touches several packages in a fixed
order, and skipping a layer is what produces a 500 dressed as "unknown error" or a screen
that calls a procedure nobody mounted.

## 0. Locate the owner and the existing shape

```bash
grep -n '"<subject>"' packages/features/catalogue.json        # who owns it
find packages/features/<f> -maxdepth 4 -type d | grep -v node_modules
grep -rn "abstract class .*Service" packages/features/<f>/contract/src
```

Read the owning service, its repository interface, its tRPC and REST transports, and
the web api-map. Copy their idiom exactly; do not introduce a second style.

## 1. Spec

Add scenarios to `packages/features/<f>/specs/*.feature` (or `specs/<area>/*.feature`
if the behaviour is cross-cutting): the golden path and each named failure with its
error code, tagged `@unit`/`@integration`. Every scenario you add will be bound by a test
in this change.

## 2. Contract

- Inputs: a zod schema in `<subject>.commands.ts` (writes) or `<subject>.queries.ts`
  (reads), types via `z.infer`. Outputs: a named `*Output` type.
- The abstract service in `<subject>.service.ts` gains the method signature.
- New failure: a `HandledError` subclass in `<subject>.errors.ts` with a stable code;
  add the code to `packages/handled-error/src/app-codes.ts` (sorted) and its customer
  copy to `presentation.ts`. Set `fault` explicitly on any 5xx.
- Do not make an existing schema `.strict()` unless you own every producer.

## 3. Server

- **Repository**: add the method to the abstract `<name>.repository.ts` and to
  `repositories/prisma/prisma.<name>.repository.ts` (and any other qualifier folder that
  implements it). `projectId` in every where clause. New columns: edit
  `packages/prisma-client/prisma/schema.prisma`, add a migration, run
  `pnpm start:prepare:files`.
- **Service**: implement the method in `services/<name>.service.ts`; validation and
  guards live here, not in the transport. Return or throw; `try*` for nullable reads.
- **App**: if the feature has `app/<f>.app.ts`, the operation goes through it so REST
  and tRPC share one path; authorization is checked here.
- **Transport**: add the procedure to `transport/api-trpc/<subject>.api.ts` (parse with
  the contract schema, call the app) and/or the route to
  `transport/api-rest/<subject>.api.ts` (throw, never `c.json({ error })`). The published
  OpenAPI document is generated; do not hand-edit it.
- **Tests**: `services/__tests__/<name>.service.unit.test.ts` binds the `@unit`
  scenarios; a transport or repository integration test binds the `@integration` ones.

## 4. Composition

If the new method needs a collaborator the service does not yet receive (a port, another
feature's service, a ClickHouse accessor), thread it through the composition root in
`apps/api/src/app/api-<f>*.composition.ts` (and the worker's installer if the worker runs
it). Required, or a named absence; never an optional parameter nobody passes. A new REST
family is registered in `apps/api/src/app-rest/app-rest.packaged-families.ts`.

## 5. Web

- `behavior/<f>-api.ts`: add the procedure to the `<F>ApiMap` with contract input and
  output types.
- `behavior/use-<thing>.ts`: the hook. Mutations read failures with `readHandledError`
  and map `meta.fieldErrors` onto the form.
- `ui/elements` / `ui/blocks` for new presentation, `ui/sections` where it meets data,
  the screen composes it. New drawer: `ui/sections/drawers.ts` entry, opened by address,
  registered in `apps/ui/src/features/installed-ui-drawers.ts`.
- Copy per `dev/docs/best_practices/copywriting.md`; patterns per `react.md`,
  `drawers.md`, `row-actions-overflow-menu.md`, `selection-action-bar.md`.
- Component tests `.integration.test.tsx` (jsdom docblock) bind the UI scenarios.

## 6. Gates, scoped to what you touched

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test && pnpm --filter @langwatch/<f>-web test
pnpm --filter @langwatch/<f>-server exec tsc --noEmit -p tsconfig.json     # each touched package
pnpm --filter @langwatch/platform-api exec tsc --noEmit -p tsconfig.json   # if a root changed
pnpm --filter @langwatch/architecture-lint lint
pnpm --filter @langwatch/architecture-lint exec tsx src/check-feature-parity.ts
pnpm exec oxlint <touched> && pnpm exec oxfmt <touched>
```

Sabotage once: revert the service change and confirm the new test fails for the right
reason, then restore. A test that passes without the code guards nothing.

## Report

Scenario titles and the tests that bind them; each layer's files; the error codes added;
gate numbers; anything left absent by design.
