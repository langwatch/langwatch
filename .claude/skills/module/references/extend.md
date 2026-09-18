# Extend a module

Read `dev/docs/ARCHITECTURE.md` §3 and the layer you touch. The point of this
reference is that one capability touches several packages in a fixed order,
and skipping a layer is what produces a 500 dressed as "unknown error" or a
screen that calls a procedure nobody mounted. Adding a REST route or a tRPC
procedure is part of this same walk: `references/transport.md` has the
transport steps in full and assumes sections 0 to 5 here were walked first; do
not treat it as a separate task.

## 0. Locate the owner and its shape

```bash
grep -n '"<subject>"' modules/catalogue.json        # who owns it
find modules/<f> -maxdepth 4 -type d | grep -v node_modules
grep -n '"<f>"' packages/architecture-enforcer/src/feature-shape-baseline.json   # what it still carries from the older shape
```

Read the contract's `<f>.api.ts`, the `<Name>Module` class, the repository
interfaces, the transport declarations and the browser api-map. A module with
no baseline entries is in the target shape: follow it exactly. A module with
entries is mid-conversion: **add the capability in the target shape** (an
operation on `<Name>Module`, a method on the repository interface and both
backends, an inline handler on the flat declaration) and do not add to the
legacy pieces (no new method on an abstract contract service, no new route in
a nested `transport/api-trpc/`). If the legacy piece is the only place the
module has, say so in the report; converting the module is
`references/convert.md`'s job.

## 1. Spec

Add scenarios to `modules/<f>/specs/*.feature`: the golden path and each named
failure with its error code, tagged `@unit`/`@integration`. Follow the
`spec-bind` skill; every scenario you add will be bound by a test in this
change.

## 2. Contract

- Inputs and outputs: zod schemas in `<f>.schemas.ts` (or the
  `<f>-<part>.schemas.ts` that owns the shape), types via `z.infer`.
  Door-specific input shapes go in `<f>-trpc.schemas.ts` / `<f>-rest.schemas.ts`.
- The operation joins `interface <F>Api` in `<f>.api.ts` with an RPC verb
  (`get`, `getMany`, `list`, `create`, `update`, `delete`, `<verb><Entity>`).
- New failure: a `HandledError` subclass in `<f>.errors.ts` with a stable
  `code`, explicit `fault` and `httpStatus`; add the code to
  `packages/handled-error/src/app-codes.ts` (sorted) and its customer copy to
  `packages/handled-error/src/presentation.ts`.
- A new deployment fact (a signing key, a base URL) is a field on
  `<f>.config.ts` (record §6, §3.3 case 3), never a raw `process.env` read.
- Do not make an existing schema `.strict()` unless you own every producer.

## 3. Process

- **Repository**: add the method to the interface in
  `repositories/<name>.repository.ts`, to
  `repositories/prisma/prisma.<name>.repository.ts` (`projectId` in every
  where clause) **and** to `repositories/memory/memory.<name>.repository.ts`
  with the same observable behaviour. New columns: edit
  `packages/prisma-client/prisma/schema.prisma`, add a migration, run
  `pnpm start:prepare:files`.
- **Service**: implement the method in `services/<name>.service.ts`: parse
  the input with the contract schema, call the repository, throw the
  entity's error. Pure helpers go in `rules/<name>.rules.ts`, never a `utils/`
  folder.
- **`<Name>Module`**: the operation goes on the class so every transport
  shares one path. Peer calls (`this.#projects.getOrganizationId(...)`),
  authorization decisions through `AuthzApi`, cross-entity workflows and side
  effects live here. A new peer is a token added to `static dependencies`,
  provided by the process (section 5).
- **Transport**: a browser-facing procedure follows `references/transport.md`
  section 2 (an inline handler on `transport/<f>.trpc.ts`); a public HTTP
  endpoint follows `references/transport.md` section 1 (an inline handler on
  `transport/<f>.rest.ts`).
- **Availability**: a capability this deployment may not have is a declared
  supply token (four-way rule case 4) the process answers with `.provide({...})`
  — never a bespoke default the module invents for itself.
- **Tests**: `services/__tests__/<name>.service.unit.test.ts` and
  `__tests__/*.unit.test.ts` over `create<F>TestModule` bind the `@unit`
  scenarios; a transport or Prisma repository integration test binds the
  `@integration` ones. Extend `__tests__/<f>.fixture.ts` when a peer method is
  new: `createApiFixture` throws on any method the fixture does not
  configure.

## 4. Browser

- `behavior/<f>-api.ts`: add the procedure to the `<F>ApiMap` with contract
  input and output types. Never `AppRouter` (ADR-130); the segment names are
  the cache key.
- `behavior/use-<thing>.ts`: the hook. Mutations read failures with
  `readHandledError` and map `meta.fieldErrors` onto the form.
- `ui/elements` / `ui/blocks` for new presentation, `ui/sections` where it
  meets data, the screen composes it. A new host need (a fact or an action
  from the application) is a method on the `*HostApi` in
  `model/<f>-host.ts`, implemented by the shell from `browser-host`
  capabilities and in `src/testing.tsx`'s stub.
- Copy per `dev/docs/best_practices/copywriting.md`; patterns per the
  `design-system` skill.
- Component tests `.integration.test.tsx` (jsdom docblock) bind the UI
  scenarios.

## 5. Process supply

A new peer token `<Name>Module` declares resolves module-to-module when both
are installed; nothing is wired by hand. If the peer is absent, `boot()` does
not compile and the refusal names the token. Do not add an optional
parameter, a `refusing*` variant or a `Logged*Absence` (record §15).

Adding a REST endpoint or a tRPC procedure is `references/transport.md`.

## 6. Gates

Scoped to what you touched: `feature-shape` must not gain an entry for the
module. For a transport change, add:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-process test && pnpm --filter @langwatch/<f>-browser test
pnpm --filter @langwatch/<f>-process typecheck && pnpm --filter @langwatch/platform-api typecheck && pnpm --filter @langwatch/ui typecheck
```

Sabotage once: revert the service change and confirm the new test fails for
the right reason, then restore. A test that passes without the code guards
nothing; a sabotage that matched nothing is not evidence, so say when that
happens.

## Report

Scenario titles and the tests that bind them; each layer's files; the error
codes added; whether a transport was added (operations with method/path/version
and permission, or namespace and procedure names); gate results; anything left
absent by design; whether the module still carries legacy pieces you had to
work beside.
