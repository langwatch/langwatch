---
name: feature-extend
description: "Add or change one capability in an existing LangWatch feature package end to end: a new command or query, a new field, a new screen section or drawer, a new failure mode. Walks contract → server (service, repository, transport) → composition → web (behavior, section, screen) with the spec scenario written first and every layer kept inside the strict layout grammar. Use whenever someone asks to add a mutation, a column, a filter, a button that does something new, a validation, an error message, or 'make <feature> also do X', and the subject already has a package under packages/features or packages/enterprise/features. For the transport step itself, hand off to api-rest-route or api-trpc-procedure."
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

Read the owning service, its repository interface, its transports, and the web api-map.
Copy their idiom exactly; do not introduce a second style.

## 1. Spec

Add scenarios to `packages/features/<f>/specs/*.feature` (or `specs/<area>/*.feature`
if the behaviour is cross-cutting): the golden path and each named failure with its
error code, tagged `@unit`/`@integration`. Follow `spec-bind`; every scenario you add
will be bound by a test in this change.

## 2. Contract

- Inputs: a zod schema in `<subject>.commands.ts` (writes) or `<subject>.queries.ts`
  (reads), types via `z.infer`. Outputs: a named `*Output` type.
- The abstract service in `<subject>.service.ts` gains the method signature.
- New failure: a `HandledError` subclass in `<subject>.errors.ts` with a stable code;
  add the code to `packages/handled-error/src/app-codes.ts` (sorted) and its customer
  copy to `packages/handled-error/src/presentation.ts`. Set `fault` explicitly on any 5xx.
- Do not make an existing schema `.strict()` unless you own every producer.

## 3. Server

- **Repository**: add the method to the abstract `<name>.repository.ts` and to
  `repositories/prisma/prisma.<name>.repository.ts` (and any other qualifier folder that
  implements it). `projectId` in every where clause. New columns: edit
  `packages/prisma-client/prisma/schema.prisma`, add a migration, run
  `pnpm start:prepare:files`.
- **Service**: implement the method in `services/<name>.service.ts`; validation and
  guards live here, not in the transport. Return or throw; `try*` for nullable reads.
  Pure helpers the service needs go in `rules/<name>.rules.ts`, never a `utils/` folder.
- **App**: if the feature has `app/<f>.app.ts`, the operation goes through it so every
  transport shares one path; authorization is checked here.
- **Transport**: a browser-facing procedure follows `.claude/skills/api-trpc-procedure`;
  a public HTTP endpoint follows `.claude/skills/api-rest-route`. Touch
  `transport/api-rest/` only to keep an existing URL working.
- **Tests**: `services/__tests__/<name>.service.unit.test.ts` binds the `@unit`
  scenarios; a transport or repository integration test binds the `@integration` ones.

## 4. Composition

If the new method needs a collaborator the service does not yet receive (a port, another
feature's service, a ClickHouse accessor), thread it through the API-side composition in
`apps/api/src/features/<f>/<f>.composition.ts` — or the family root in
`apps/api/src/app/api-<f>*.composition.ts` where one exists — and the worker's installer
if the worker runs it. Required, or a named absence; never an optional parameter nobody
passes. See `references/config-composition.md`, "Adding a port and wiring it".

## 5. Web

- `behavior/<f>-api.ts`: add the procedure to the `<F>ApiMap` with contract input and
  output types. Never `AppRouter` (ADR-130); the segment names are the cache key.
- `behavior/use-<thing>.ts`: the hook. Mutations read failures with `readHandledError`
  and map `meta.fieldErrors` onto the form.
- `ui/elements` / `ui/blocks` for new presentation, `ui/sections` where it meets data,
  the screen composes it. A new drawer is registered on the feature's
  `uiFeature({ drawers })` in `apps/ui/src/features/<f>/index.ts`.
- Copy per `dev/docs/best_practices/copywriting.md`; patterns per the `design-system`
  skill.
- Component tests `.integration.test.tsx` (jsdom docblock) bind the UI scenarios.

## 6. Gates

`.claude/skills/architecture-guide/references/gates.md`, scoped to what you touched.

Sabotage once: revert the service change and confirm the new test fails for the right
reason, then restore. A test that passes without the code guards nothing; a sabotage that
matched nothing is not evidence, so say when that happens.

## Report

Scenario titles and the tests that bind them; each layer's files; the error codes added;
gate numbers; anything left absent by design.
