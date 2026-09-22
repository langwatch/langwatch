# ADR-147: The process supply is checked by the compiler

**Date:** 2026-09-17

**Status:** Accepted; not yet implemented

**Behavioural contract:**
[A process cannot boot without what its modules declared](../../../specs/server/typed-process-supply.feature)

**Related:** [declarative process composition (the architecture record, §8; ADR-144 on this branch is trace search)](../ARCHITECTURE.md)
(**amended by this ADR**; its principle stands), [ADR-132: secrets are not
config](./132-secrets-are-not-config.md), [ADR-102: runtime composition
roots](./102-runtime-composition-roots.md)

## Context

ADR-144 established that a module declares everything it contributes and a
process supplies it. The declaration half works: a module states the members it
reads with `reads(...)`, its peers with `static dependencies`, and its own
settings with `configSchema`. `reads()` takes a `const` type parameter, so those
names survive as a literal tuple and `MembersRead<typeof App.reads>` types the
module's own view exactly.

The supply half throws that away. `createApp({ role, config, members })` is
handed its config and its members **before** `.withModules(...)` says which
modules will be installed, so at the point they are supplied the required set is
unknown and nothing can be checked:

- `config` is `Readonly<Record<string, unknown>>` — any object satisfies it.
- `members` is a `MemberSource` built from `Readonly<Partial<Members>>`, so
  `membersFrom({})` type-checks.
- a peer a module declares is resolved during boot, so an unsatisfied one is a
  runtime refusal.

Every one of those is a boot-time failure where the compiler held the answer.
Measured cost on this branch: `managed-provider` was installed by both processes
with no config slice supplied, because `apiModuleConfig` is a hand-written map
and nobody added the line. It crash-looped. A second instance is latent —
`compileDefinition` returns `z.object(shape)`, which strips unknown keys in
silence, so a misspelled slice key disables a feature with no signal at all.

## Decision

The supply becomes a fluent chain whose type state accumulates what the
installed modules require, and `boot()` takes no arguments and is callable only
when nothing is outstanding.

```ts
await createApp({ role: "api" })
  .withModules(serverModules)
  .withConfig(apiModuleConfig(config))
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withObservability((o) => o.withLogging(pino).withTracing(otel()).withMetrics(otel()))
  .withTransportAuth((a) => a
    .withStaticTokens({ cron, langyInternal, instanceAdmin })
    .withBrowserSession(session))
  .boot();
```

`apps/worker` is the same chain without `withTransportAuth`. That one call is
the whole difference between the roles, which is the test of the next point.

1. **What is required is computed from what is installed.** A process installing
   one module that reads only a clock is asked for a clock and nothing else. A
   process installing nothing analytical is never asked for an analytical store.
2. **Everything outstanding is named at once**, not one failure at a time.
3. **`role` names the process and decides nothing.** Today it silently selects
   which halves of a module run. After this, what a process serves is what it
   said it serves.
4. **Stores are opened from configuration.** `createProcessMembers` already
   builds every member from `processConfig` — `apps/api` passes exactly one
   explicitly — so naming a store in the composition is an OVERRIDE, and an
   override against a configured endpoint is warned about.
5. **The fourteen members are renamed for what they are.** Stores (relational,
   analytical, blobs, keyvalue), channels (eventing, mail), facilities (logging,
   metrics, tracing, clock) and the root-level secrets and encryption. `cache`,
   `rateLimiter` and `idempotency` stop being supplied at all: they are derived,
   the first two from the key-value store and the third from the relational one.
6. **`telemetry` becomes `metrics`, and `tracing` is added.** The member is
   `count()` and `observe()` and nothing else, so a module that wants a span has
   no declared way to get one.
7. **Unknown configuration keys are dropped and every drop is logged.** Blanket
   `.strict()` is the wrong fix — it refuses a config carrying a key a newer
   module added. A misspelled REQUIRED field still refuses the boot by itself.

## Consequences

`withProvided`, `withInfrastructure`, `withPersistence`,
`withMemoryRepositories`, `membersFrom` and the process-side `withTransports`
are deleted. `provide` replaces `withProvided` and is keyed by module id rather
than positional, which requires one id to mean one API — `ActivatedLicenseSource`
currently breaks that, being a second API declared under the `licensing`
module's own id because `ModuleName` is a closed catalogue union with no other
legal name. That must be resolved first, and a lint has to hold it.

`moduleApi<Api>(name)` erases the name, so peers cannot be subtracted from
requirements. It curries to carry it: `moduleApi<ProjectApi>()("project")`.
About fifty declaration sites, one regex codemod.

`apps/ui` is NOT on this shape and is out of scope. Its generated web list is
empty, and what runs is `collectWebInstallations` over a hand-listed array merged
with a legacy set, where a `WebInstallation` is an imperative `install(ui)` rather
than a declaration.

Verified before adoption against a generated 49-module graph matching the real
`serverModules` shape, which is already `as const`: it compiles in under a second
of `tsc` work and still names a missing config slice, a missing member and an
unsatisfied peer at that size. The per-module config intersection must be
flattened through `type Simplify<T> = { [K in keyof T]: T[K] } & {}` for the
error to read as a missing-properties list rather than a forty-way intersection.
