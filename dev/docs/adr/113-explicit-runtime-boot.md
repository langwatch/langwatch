# ADR-113: Explicit runtime boot owns configuration and application construction

**Date:** 2026-08-24

**Status:** Accepted; implementation deferred until the application workspace
split

**Related:** [ADR-093: Redis is an owned client](./093-redis-is-an-owned-client.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md),
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
[ADR-111: physical application workspaces](./111-physical-application-workspaces.md),
and [ADR-112: singular feature ownership](./112-singular-feature-ownership.md).

## Context

`platform/app/src/env.mjs` currently exports an environment object whose
validation runs when the module is imported. More than one hundred application
modules import that object directly. Whether a command validates configuration,
which configuration it validates, and whether environment files were loaded
first therefore depend on module evaluation order. Workers already need a
mixture of side-effect imports, dynamic imports, and `require` calls to preserve
that order.

This makes otherwise harmless imports capable of terminating a test, build,
migration, or one-shot task for configuration that runtime does not use. It
also lets services read deployment vocabulary long after boot and makes it hard
to prove that a listener starts only after configuration, infrastructure, the
application graph, and readiness checks have succeeded.

ADR-104 established runtime-owned validation and semantic configuration, while
ADRs 102, 111, and 112 established one composed application graph whose services
are injected into transports. This decision makes their boot boundary explicit.
It tightens ADR-104 by rejecting an eagerly evaluated exported environment
singleton; it does not change ADR-104's public browser configuration contract.

## Decision

### Every executable has one explicit boot path

Each Node executable owns three small modules:

```text
src/
├── config.ts  # pure schemas and configuration resolution
├── boot.ts    # ordered construction, checks, start, and shutdown ownership
└── main.ts    # executable entry point; invokes boot and reports fatal failure
```

`config.ts` is safe to import. It exports Zod 4 schemas, immutable semantic
configuration types, and a class-based configuration service whose `resolve`
method accepts an explicit source. It does not read `process.env`, load files,
validate values, create clients, log, or mutate process state at module
evaluation time.

`main.ts` is the only ordinary process side-effect boundary. It calls the
runtime's boot class with the environment source and process facilities. Tests,
build tools, migrations, seeds, and one-shot tasks call a suitable boot profile
or the pure configuration service explicitly; importing application code never
boots the product.

The API, worker, combined development runtime, CLI, and any independently
deployed service have separate configuration schemas and boot classes. They may
reuse configuration primitives, but do not import another executable's resolved
configuration or boot module.

### Boot is an ordered, failure-safe lifecycle

The boot class performs the following phases in order:

1. load explicitly selected environment sources and initialize the process
   observability prelude;
2. validate and normalize that executable's configuration once;
3. create a `ResourceScope` and process-owned infrastructure clients;
4. construct exactly one immutable LangWatch App service graph;
5. initialize installed feature contributions and process integrations;
6. run bounded startup checks for required dependencies and invariants;
7. construct transports or consumers with the App injected into their context;
8. begin listening or consuming only after every required phase succeeds; and
9. close transports, the App, and owned resources in the registered shutdown
   order.

If any phase fails, boot closes every resource already registered in the scope
before returning the error. Configuration and readiness services return typed,
sanitized failures; they do not call `process.exit`. Only `main.ts` chooses the
process exit code after fatal diagnostics have been flushed.

Readiness is distinct from liveness. A required dependency failing its startup
probe prevents the process from accepting work. Optional integrations are
selected from validated configuration and report their own availability
without turning unrelated configuration into a boot requirement.

### The resolved process configuration is not a service locator

Boot may hold the complete resolved configuration for its executable while it
constructs the graph. Each client, adapter, and feature service receives only
the semantic configuration values it needs. Feature packages do not import an
application config module, read `process.env`, or receive a generic environment
bag.

The App contains canonical service capabilities, not raw deployment secrets or
general database escape hatches. The API constructs the App once per process.
Hono handlers receive it as `c.var.langwatchApp`, tRPC handlers receive the same
instance as `ctx.app`, and worker handlers receive it from their runtime. A
request does not create a service graph, and application code does not fall back
to a global `getApp()` once its transport has an injected App.

The existing `env.mjs`, `env-create.mjs`, import-order comments, and global App
fallbacks are migration inputs rather than compatibility APIs. They are removed
incrementally as the physical app split creates the new boot roots. No second
resolved-config singleton is introduced during that migration.

### Boot checks are explicit and testable

Every boot phase is represented by a class or injected capability and can be
exercised without binding a real listener. Tests cover invalid configuration,
phase ordering, failure cleanup, readiness refusal, successful App identity
across Hono and tRPC, and idempotent shutdown. Import tests prove that importing
config, feature, route, and service modules performs no validation or resource
creation.

Architecture lint eventually restricts `process.env`, environment-file loading,
listener binding, signal handlers, and process exits to executable boot
surfaces and narrowly declared contributor tooling. It also rejects eager
configuration exports and transport-local construction of feature services or
repositories.

## Alternatives considered

Keeping the eager `env` export and ensuring every entry point imports an
environment loader first was rejected because correctness still depends on
JavaScript module evaluation order and unrelated imports still validate the
whole application.

Making every feature parse its own environment was rejected because it spreads
deployment vocabulary through reusable packages, repeats parsing, and prevents
the executable from knowing its requirements before it starts.

Using a global lazy configuration or App singleton was rejected because it
hides lifecycle and test ordering rather than defining them. Laziness changes
when the implicit side effect occurs; it does not make ownership explicit.

Creating services inside Hono or tRPC handlers was rejected because it creates
per-request object graphs, duplicates pools and caches, and can give two
transports different implementations of the same product capability.

## Consequences

- Importing a module no longer validates deployment configuration or creates a
  resource.
- Every executable has a visible startup contract and fails before accepting
  work when a required dependency or invariant is unavailable.
- Hono, tRPC, workers, tasks, and tests can use the same canonical App instance
  without relying on global Prisma or `getApp()`.
- Failed boot and shutdown have deterministic resource ownership and cleanup.
- Commands with smaller dependency graphs validate only their own settings.
- Boot modules contain more explicit wiring, and each executable needs focused
  lifecycle tests.
- Migrating the current environment imports and global App fallbacks is broad
  work and remains sequenced with the physical application split rather than
  being mixed into the feature-ownership rename.
