---
name: feature-extend
description: "Add or change one capability in an existing LangWatch feature package end to end: a new operation, a new field, a new screen section or drawer, a new failure mode. Walks contract (schema, API operation, error) → server (repository interface and both backends, service, app, transport declaration) → composition → web (api-map, hook, section, screen) with the spec scenario written first and every layer kept inside the annotation shape. Use whenever someone asks to add a mutation, a column, a filter, a button that does something new, a validation, an error message, or 'make <feature> also do X', and the subject already has a package under packages/features or packages/enterprise/features. For the transport step itself, hand off to api-rest-route or api-trpc-procedure."
user-invocable: true
argument-hint: "<feature> <what to add, e.g. 'annotation: mark an annotation resolved'>"
---

# Extend a feature

Read `.claude/skills/architecture-guide/SKILL.md` and the reference for each layer you
touch. The point of this skill is that one capability touches several packages in a fixed
order, and skipping a layer is what produces a 500 dressed as "unknown error" or a screen
that calls a procedure nobody mounted.

## 0. Locate the owner and its shape

```bash
grep -n '"<subject>"' packages/features/catalogue.json        # who owns it
find packages/features/<f> -maxdepth 4 -type d | grep -v node_modules
grep -n '"<f>"' packages/architecture-lint/src/feature-shape-baseline.json   # what it still carries from the older shape
```

Read the contract's `<f>.api.ts`, the app, the repository interfaces, the transport
declarations and the web api-map. A feature with no baseline entries is in the annotation
shape: follow it exactly. A feature with entries is mid-conversion: **add the capability
in the annotation shape** (an operation on the app, a method on the repository interface
and both backends, an inline handler on the flat declaration) and do not add to the legacy
pieces (no new method on an abstract contract service, no new route in
`transport/api-trpc/`, no new adapter). If the legacy piece is the only place the feature
has, say so in the report; converting the feature is a separate job.

## 1. Spec

Add scenarios to `packages/features/<f>/specs/*.feature` (or `specs/<area>/*.feature`
if the behaviour is cross-cutting): the golden path and each named failure with its
error code, tagged `@unit`/`@integration`. Follow `spec-bind`; every scenario you add
will be bound by a test in this change.

## 2. Contract

- Inputs and outputs: zod schemas in `<f>.schemas.ts` (or the `<f>-<part>.schemas.ts`
  that owns the shape), types via `z.infer`. Door-specific input shapes go in
  `<f>-trpc.schemas.ts` / `<f>-rest.schemas.ts`.
- The operation joins `interface <F>Api` in `<f>.api.ts` with an RPC verb (`get`,
  `getMany`, `list`, `create`, `update`, `delete`, `<verb><Entity>`).
- New failure: a `HandledError` subclass in `<f>.errors.ts` with a stable `code`, explicit
  `fault` and `httpStatus`; add the code to `packages/handled-error/src/app-codes.ts`
  (sorted) and its customer copy to `packages/handled-error/src/presentation.ts`.
- Do not make an existing schema `.strict()` unless you own every producer.

## 3. Server

- **Repository**: add the method to the interface in `repositories/<name>.repository.ts`,
  to `repositories/prisma/prisma.<name>.repository.ts` (`projectId` in every where
  clause) **and** to `repositories/memory/memory.<name>.repository.ts` with the same
  observable behaviour. New columns: edit `packages/prisma-client/prisma/schema.prisma`,
  add a migration, run `pnpm start:prepare:files`.
- **Service**: implement the method in `services/<name>.service.ts`: parse the input with
  the contract schema, call the repository, throw the entity's error. Pure helpers go in
  `rules/<name>.rules.ts`, never a `utils/` folder.
- **App**: the operation goes on `app/<f>.app.ts` so every transport shares one path.
  Peer calls (`this.#projects.getOrganizationId(...)`), authorization decisions through
  `AuthzApi`, cross-entity workflows and side effects live here. A new peer is a token
  added to `static dependencies`, provided by the composition (step 4).
- **Transport**: a browser-facing procedure follows `.claude/skills/api-trpc-procedure`
  (an inline handler on `transport/<f>.trpc.ts`); a public HTTP endpoint follows
  `.claude/skills/api-rest-route` (an inline handler on `transport/<f>.rest.ts`).
- **Tests**: `services/__tests__/<name>.service.unit.test.ts` and
  `app/__tests__/*.unit.test.ts` over `create<F>TestApp` bind the `@unit` scenarios; a
  transport or Prisma repository integration test binds the `@integration` ones. Extend
  `app/__tests__/<f>.fixture.ts` when a peer method is new: `createApiFixture` throws on
  any method the fixture does not configure.

## 4. Composition

A new peer token the app declares must be provided where the feature is installed:
`.withProvided(PeerApi, peer)` in `apps/api/src/features/<f>/<f>.composition.ts` (and the
worker root that installs the same server, if any). Boot names a missing provider before
constructing anything; do not add an optional parameter, a `refusing*` variant or a
`Logged*Absence`. See `references/config-composition.md`. A new namespace or REST family
also touches `app-trpc.features.ts` / the REST mount (the transport skills say where).

## 5. Web

- `behavior/<f>-api.ts`: add the procedure to the `<F>ApiMap` with contract input and
  output types. Never `AppRouter` (ADR-130); the segment names are the cache key.
- `behavior/use-<thing>.ts`: the hook. Mutations read failures with `readHandledError`
  and map `meta.fieldErrors` onto the form.
- `ui/elements` / `ui/blocks` for new presentation, `ui/sections` where it meets data,
  the screen composes it. A new host need (a fact or an action from the application) is a
  method on the `*HostPort` in `model/<f>-host.ts`, implemented in
  `apps/ui/src/features/<f>/ui/sections/<f>-host.tsx` and in `src/testing.tsx`'s stub.
- Copy per `dev/docs/best_practices/copywriting.md`; patterns per the `design-system`
  skill.
- Component tests `.integration.test.tsx` (jsdom docblock) bind the UI scenarios.

## 6. Gates

`.claude/skills/architecture-guide/references/gates.md`, scoped to what you touched.
`feature-shape` must not gain an entry for the feature.

Sabotage once: revert the service change and confirm the new test fails for the right
reason, then restore. A test that passes without the code guards nothing; a sabotage that
matched nothing is not evidence, so say when that happens.

## Report

Scenario titles and the tests that bind them; each layer's files; the error codes added;
gate numbers; anything left absent by design; whether the feature still carries legacy
pieces you had to work beside.
