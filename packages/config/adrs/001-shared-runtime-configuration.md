# ADR-001: JavaScript runtimes share configuration mechanics, not one global schema

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Shared runtime configuration](../specs/runtime-configuration.feature)

**Related:**
[ADR-104: runtime environment configuration](../../../dev/docs/adr/104-runtime-environment-configuration.md).

## Context

Go services share `pkg/config` for hydration and validation while each service
owns its concrete `Config` struct, defaults, required values, and cross-field
rules. JavaScript currently has strong app-specific T3 Env validation, but the
mechanics and conventions are not reusable by a future worker, ingestion
service, CLI, or separately deployed TypeScript process.

A single global JavaScript environment schema would recreate the monolith: a
worker could fail because an app-only variable is absent, every feature could
discover every secret, and tests would need an enormous fixture. What should be
shared is the safe way to parse configuration, not universal access to it.

## Decision

Create `@langwatch/config` as the JavaScript counterpart to Go's shared config
mechanism. A service declares configuration in the nested semantic shape it
actually consumes. The declaration compiles to Zod and to deterministic
environment bindings. A runtime supplies the environment source to
`RuntimeConfig.create`; the result contains only declared fields, is normalized
before services are constructed, and is exposed as a read-only nested value.

The package provides a small set of conventions that must behave identically
across services: nested-key environment naming, strict booleans, numbers,
ports, durations, URLs, secrets, enums, sanitized validation failures, and
explicit source injection for tests. Service-specific defaults and cross-field
validation remain beside the service declaration.

In this decision, a runtime is a deployable JavaScript service or entry point:
the interactive app, worker, future ingestion service, or CLI. Every installed
service class may declare the semantic Zod config it requires and local-safe
defaults; the runtime composes only those declarations. A service can fail only
for settings in its schema, and a missing variable owned by an uninstalled or
different service is irrelevant. The deployable root remains responsible for
mapping environment names into the semantic values.

```ts
class RequestLimiterService {
  static readonly config = RuntimeConfig.define({
    rateLimit: {
      ttlMs: 15_000,
      enabled: true,
    },
    redisUrl: Config.url(),
  });

  static create(input: { config: ConfigValue<typeof RequestLimiterService.config> }) {
    return new RequestLimiterService(input.config);
  }
}

const requestLimiterConfig = RuntimeConfig.create({
  name: "request-limiter",
  definition: RequestLimiterService.config,
  source: process.env,
}).value;
```

The declaration above produces the semantic value
`{ rateLimit: { ttlMs, enabled }, redisUrl }` and these default environment
bindings:

```text
rateLimit.ttlMs  -> RATE_LIMIT_TTL_MS
rateLimit.enabled -> RATE_LIMIT_ENABLED
redisUrl          -> REDIS_URL
```

An absent environment value uses the inline default. A present value is parsed
into the leaf's declared type before Zod validates the compiled object. Plain
boolean, number and string defaults cover the common case. `Config.url()`,
`Config.secret()`, `Config.enum(...)`, `Config.integer(...)` and
`Config.value(...)` express required values or stronger validation without
flattening the service's configuration shape.

The name transformation splits camelCase, joins nested keys with underscores,
and uppercases the result. Definitions fail at construction if two semantic
paths normalize to the same environment name. A leaf may declare an explicit
environment name only for a real external compatibility constraint; automatic
naming is the default.

### Public surfaces and transports

The sole public package entry point exports `RuntimeConfig`, `Config` leaf
helpers, inferred value types, compiled Zod schemas, and
`InvalidRuntimeConfigError`. Configuration has no HTTP, RPC, browser, queue, or
background transport of its own.

### Dependencies

The package depends only on Zod. T3 Env remains an app-runtime integration
during migration and may compose the same schemas, but reusable packages do not
depend on the app's T3 environment module.

### Persistence

Persistence does not apply because runtime configuration is parsed once during
process startup and is never written to a database, cache, or generated file.

### Runtime and registration

Each app, worker, service, or CLI composition root calls
`RuntimeConfig.create` for the services it installs before building their
instances. Importing the package reads no environment and registers no
listener, service, transport, or global singleton.

### Environment and configuration

The shared package never reads `process.env` itself. Only runtime composition
modules obtain an environment source and pass it explicitly, which also lets
tests supply a minimal object without mutating process-global state.

### Errors

Invalid configuration throws `InvalidRuntimeConfigError` before service
construction. It carries the runtime name plus Zod issue paths and codes, but
never echoes raw input values that may contain credentials.

### Contracts and validation

Every definition compiles to a Zod schema, and that compiled schema is the
validation source of truth. It parses environment strings into typed nested
values, strips undeclared fields, applies declared defaults, infers TypeScript
output types, and can be composed into separate app, worker, or service
contracts.

## Alternatives considered

One repository-wide environment schema was rejected because it couples every
process to every variable and exposes a universal secret bag. Letting each
service invent its own loader was rejected because boolean parsing, duration
units, error safety, and test behavior would continue to drift.

Wrapping every T3 Env feature in this first package version was deferred. The
app already has extensive T3 validation, while other TypeScript runtimes need a
small Zod-first core. T3 can remain the app adapter while its schemas migrate
onto the shared primitives.

## Consequences

- JavaScript runtimes gain one tested configuration convention analogous to Go.
- Each runtime still has a narrow schema and can boot independently.
- Feature services declare and receive typed nested values rather than
  environment names.
- Validation diagnostics identify fields without disclosing their values.
- Existing app T3 configuration migrates incrementally instead of being
  rewritten in the same feature-package extraction.
