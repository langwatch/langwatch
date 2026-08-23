# ADR-104: Runtime roots validate environment and expose explicit configuration

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Runtime composition](../../../platform/app/specs/runtime-composition.feature)

**Related:** [ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md), and
[ADR-070: modular package architecture](./070-modular-package-architecture.md).

## Context

LangWatch is distributed as deployable processes whose configuration is
provided through environment variables. The same image may run the interactive
app, the worker, or both, and operators must be able to change public URLs,
provider selection and operational policy without rebuilding the browser
bundle.

Environment variables are an untyped process boundary. Reading
`process.env` throughout services makes configuration requirements implicit,
allows a module to observe a partially loaded environment, and makes every
consumer responsible for parsing strings. It also defeats the app/worker
split: a worker can accidentally require an app-only setting merely because it
imports the shared environment object.

Feature packages need a stronger boundary. A contract must be browser-safe, a
server package must be reusable from different processes, and a web package
must never acquire a secret through a convenient shared module. An environment
variable name is deployment vocabulary rather than feature-domain vocabulary;
features should receive values and capabilities, not know how an operator
spells them.

The browser still needs some deployment-time information, including the
public application and gateway URLs, enabled sign-in mode, deployment kind and
telemetry settings. Embedding those values with `NEXT_PUBLIC_*` or
`VITE_PUBLIC_*` would make them build-time constants and would turn a naming
prefix into the security boundary. Returning the complete server environment
would be much worse: most of it is secret, and even harmless-looking values
should not become a permanent browser contract by accident.

Some browser decisions are also caller-specific rather than environmental.
For example, an operator allow-list may cause one signed-in user to see an ops
surface. Such a decision is an authorization or viewer-capability result, not
public deployment configuration, and must not share the globally cacheable
configuration response.

## Decision

### JavaScript shares configuration mechanics, not one global schema

Use [`@langwatch/config`](../../../packages/config/adrs/001-shared-runtime-configuration.md)
as the JavaScript analogue of Go's `pkg/config`. It owns the reusable parsing
and safety conventions: Zod-first validation, strict booleans, ports, bounded
whole-second durations, sanitized errors, and explicit source injection.

Each deployable runtime still owns its concrete schema, defaults, required
values, and cross-field validation. There is deliberately no repository-wide
`Config` type and no shared object containing all environment values. The app,
worker, standalone services, and CLIs can therefore boot and test independently
while using the same mechanics. The existing T3 Env app schema migrates onto
these primitives incrementally; T3 remains an app adapter rather than a module
that feature packages import.

An environment-dependent service class declares configuration in the nested
semantic shape it consumes, including safe inline defaults. The shared config
mechanism compiles that declaration to Zod and derives environment names from
its paths (`rateLimit.ttlMs` becomes `RATE_LIMIT_TTL_MS`). A composition root
supplies the environment source only when it installs the service. A service
therefore fails only when one of its own declared requirements is invalid;
settings belonging exclusively to another service or runtime are never parsed
and cannot prevent it from starting.

### Each runtime validates its own environment once

The app and worker entry points load environment files before importing their
runtime graph. Each composition root then validates and normalizes the subset
of process configuration it owns with T3 Env (`@t3-oss/env-core`) and Zod:

```text
platform/app/src/runtime/
├── shared/environment/
│   ├── base.ts                 # values genuinely required by both runtimes
│   └── public-runtime.ts       # browser-safe output schema
├── app/environment.ts          # app bindings and installed service schemas
└── worker/environment.ts       # worker bindings and installed service schemas
```

Validation happens before feature installation or listeners start. Missing or
invalid required configuration fails that runtime's boot with the variable
name and validation error. Optional capabilities are selected explicitly from
validated configuration; the mere presence of a related secret does not
silently install a feature.

The runtime composes only the schemas of services it installs, plus its own
entry-point settings. Those schemas parse strings into useful runtime values
such as booleans, durations, URLs and bounded numbers. Code after the
composition boundary does not repeat string parsing. Build-time tooling may use
a deliberately relaxed schema when it cannot possess runtime secrets, but that
mode is explicit and is not used to start a process.

The app schema and worker schema are separate. They may compose a small shared
base, but neither imports the other and neither requires settings solely for
the other process. The combined development runtime validates both schemas and
may share the resulting infrastructure instances.

### Features receive typed configuration, never the environment

Feature `contract`, `server` and `web` packages do not import the application
environment module and do not read `process.env`. A feature contract may own a
portable configuration schema when that value is part of the domain. A server
service class may own a server-only semantic configuration schema. In both
cases, the application composition root owns the mapping from environment
variable names to those values.

```ts
const environment = AppEnvironment.create(process.env);

const agents = AgentService.create({
  database,
  workflows,
  auditLog,
});

const mailConfig = RuntimeConfig.create({
  name: "mail",
  definition: MailService.config,
  source: process.env,
}).value;

const mail = MailService.create({
  config: mailConfig,
  credentials: MailCredentials.create(environment),
});
```

The config definition returns semantic camelCase values to the service; raw
environment names and strings stop at the composition root. Installers accept
the narrowest configuration object or capability they use.
They do not receive the complete environment object, and a service that has no
configuration does not receive an empty ceremonial config object. Secrets remain in
server-only configuration or in injected provider clients; they do not enter
contract DTOs, service results, logs or browser package declarations.

Repository and infrastructure adapters may receive database, Redis,
ClickHouse and provider connection settings from the runtime root. The adapter
does not reach back into global configuration after construction.

### The browser receives an allow-listed semantic runtime contract over RPC

There are no T3 client-side environment variables. The browser obtains
deployment-time public configuration from an unauthenticated internal RPC
query served by the app runtime. The output is validated by a dedicated,
browser-safe schema and uses semantic property names rather than raw
environment-variable names:

```ts
type PublicRuntimeConfig = {
  appBaseUrl: string;
  gatewayBaseUrl?: string;
  deployment: "saas" | "self-hosted";
  auth: { provider: "email" | "auth0" | "oidc" | "saml" };
  telemetry: {
    browserTracing: boolean;
    sampleRatio: number;
    posthog?: { key: string; host?: string };
  };
  capabilities: {
    email: boolean;
    langevals: boolean;
    nlp: boolean;
  };
};
```

The procedure constructs this DTO field by field. It never spreads `env`, and
adding a server variable does not expose it. Its declaration, tests and
architecture checks reject secret-shaped fields and server-only imports. The
client caches the response for the lifetime of the page because a running
process's validated configuration is immutable; a restarted deployment causes
a new page load and query.

The RPC is part of the product application's internal API, not the public
OpenAPI surface. It is available before sign-in because authentication screens
need it. A thin server-rendered bootstrap may use the same schema later to
avoid the initial request, but it must produce exactly the same contract and
must not introduce a second configuration source.

Caller-specific UI decisions are returned by an authenticated viewer
capabilities query. They are not fields in `PublicRuntimeConfig`, even when
their policy ultimately refers to an environment-defined allow-list. Feature
web packages consume public runtime values or viewer capabilities through an
injected client/provider; they do not import the app's tRPC router or an env
module directly.

### Boundary tooling enforces configuration containment

Architecture checks reject immediately for nested feature packages and the
Design System, and extend to framework packages as their existing environment
reads move into runtime adapters:

- `process.env`, app environment modules and build-tool env globals inside
  feature packages and the Design System;
- server environment imports from contract or web packages;
- client-prefixed environment variables as a substitute for the public runtime
  RPC; and
- public runtime configuration declarations that refer to server packages,
  generated persistence types or secret-bearing configuration types.

Application entry points, runtime environment modules and narrowly scoped
infrastructure bootstrap code are the allowed environment readers.

## Alternatives considered

Build-time `NEXT_PUBLIC_*` or `VITE_PUBLIC_*` values make one browser artifact
specific to one deployment and rely on a prefix to prevent disclosure. They do
not support configuring one image at runtime and were rejected.

Inlining an arbitrary environment object into the HTML removes one network
request but weakens reviewability, complicates caching and content-security
policy, and can mix caller-specific values into globally cached documents. A
future bootstrap may inline only the validated `PublicRuntimeConfig` contract.

Allowing every feature server to read its own environment variables keeps code
locally convenient but hides process requirements and couples reusable packages
to one deployment mechanism. Service-owned semantic schemas remain useful;
the composition root still supplies their input and chooses whether the service
is installed.

Returning public values from feature-specific endpoints would duplicate
deployment configuration and create inconsistent caches. One app-level public
runtime contract is the canonical source; feature APIs expose feature
behaviour.

## Consequences

- The app and worker have explicit, independently testable configuration
  requirements.
- Feature packages remain portable and cannot accidentally load or expose
  secrets.
- One built browser artifact can run against differently configured
  deployments.
- Every client-visible value requires an intentional schema and RPC change,
  making exposure reviewable.
- Browser startup performs one cache-forever RPC unless the same contract is
  supplied through a future server-rendered bootstrap.
- Mapping environment variables into typed runtime and feature configuration
  adds composition code, but removes parsing and global reads from the rest of
  the system.
- Caller-specific capabilities need a separate authenticated query instead of
  being placed in the convenient public configuration response.
