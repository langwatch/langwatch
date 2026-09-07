# ADR-133: One feature installer, one construction path, explicit lifecycle

**Date:** 2026-09-07

**Status:** Accepted; implementation in progress

**Behavioural contract:** [Composition specification](../../../specs/server/composition-spec.feature)

**Related:** [ADR-102: runtime composition roots](./102-runtime-composition-roots.md)
(superseded in part by this ADR),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-111: physical application workspaces](./111-physical-application-workspaces.md),
[ADR-112: singular feature ownership](./112-singular-feature-ownership.md),
[ADR-045: domain errors at the handled boundary](./045-domain-errors-handled-boundary.md),
[service, repository, adapter, port](../best_practices/service-repository-adapter-port.md),
[installing a feature into an app](../best_practices/feature-installation.md).

## Context

Composition is the largest thing in the applications and the least designed.

| Measure (2026-09-07, this branch) | Count |
| --- | --- |
| `*.composition.ts` under `apps/api` and `apps/worker` | 130 files |
| Lines in those files | 36,981 |
| `apps/api/src/app/api-production.composition.ts` | 4,804 lines |
| `apps/worker/src/app/worker-production.composition.ts` | 2,310 lines |
| `function refusing*` fallbacks | 53 |
| `class *UnavailableError extends …` | 101 |
| `class Logged*Absence` reporters | 50 |
| `try*` method declarations in `*.{service,port,repository,store}.ts` | 678 |

One class holds the API graph. `ApiProductionComposition`
(`apps/api/src/app/api-production.composition.ts:623`) has a `compose()` at
`:844`, thirty-odd private `compose*`/`resolve*` methods between `:1493` and
`:4324`, and an `optionalPorts()` at `:1464` that answers five ports the
process builds for itself. Twenty `Logged*Absence` classes follow it from
`:4386` to `:4668`, each a hand-written way of saying the same sentence:
this deployment did not configure that, so the surface behind it will refuse.
`WorkerProductionComposition`
(`apps/worker/src/app/worker-production.composition.ts:396`) is the same shape
with static absence resolvers from `:1496`.

Three defects follow from the shape, not from anyone's carelessness.

1. **Optional ports production forgot.** Every field of the composition options
   object is optional so a host may override it, and the runnable process
   supplies none of them. An option with a fallback degrades; an option without
   one refuses on every deployment forever and reads to a customer as an
   outage. Five were in that second shape
   (`specs/server/api-process-optional-collaborators.feature`).
2. **Business reads in the wiring.** Composition modules hold Prisma queries and
   mappers, so the composition root is also a repository.
3. **Absence is expressed 53 + 101 + 50 ways.** A reader cannot tell from a call
   site whether a missing collaborator is a configuration choice, a degraded
   mode, or a wiring bug.

ADR-102 designed `capabilities.ts` and `defineFeature` for exactly this and
neither was built; its 2026-09-03 amendment records that both applications
compose by hand instead, and that `@langwatch/runtime-composition` now holds
only `ResourceScope` and `GracefulShutdown`. Those 130 files are 130
hand-rolled copies of the container that was never written.

This ADR records the decision Alex made on 2026-09-07. It is a specification,
not an implementation plan.

## Decision

**One feature installer, one construction path, explicit lifecycle.**

Each feature's server implementation declares its app contract token, required
peer app contracts and static `create` factory. The installer selects that class
with `.withApp(AnnotationApp)`. The framework supplies its declared dependencies
and calls `create` once during boot. API and worker reuse the same factory.

```ts
// AnnotationApp here is the server implementation, not the contract class.
export const annotationServer = serverFeature("annotation")
  .withApp(AnnotationApp)
  .build();

const runtime = await createApp({ name: "langwatch-api" })
  .withInfrastructure(infrastructure)
  .withFeature(annotationServer)
  .boot({ config, role: "api" });

await runtime.start();
```

Peer installers and transport contributions are omitted from this example.
`withFeature` declares only. `boot` validates the selected graph before calling
any factory, then constructs it in dependency order. `start` begins serving.
Imports, declarations and constructors never start background work.

### Accepted app factory shape

The portable contract exports the abstract `AnnotationApp` with readonly service
members. The server imports it as `AnnotationAppContract` and owns the concrete
`AnnotationApp`, its private constructor and its static `create`. The contract
has no infrastructure imports or construction logic.

The server class declares `static readonly contract = AnnotationAppContract`
and `static readonly dependencies`. Dependency values are peer app contract
classes. Those classes are runtime keys as well as instance types; lookup never
uses class names or parameter names. The installer derives the provided token
and required dependencies from this metadata. It does not repeat them with
`.provides(...)` or `.withDependencies(...)`.

```ts
const dependencies = {
  projects: ProjectApp,
  organizations: OrganizationApp,
};

type AnnotationSetup = FeatureSetup<
  typeof dependencies,
  AnnotationInfrastructure,
  AnnotationConfig
>;

// Members and construction body omitted; FeatureSetup is the proposed helper.
// These declarations belong on the server AnnotationApp class:
// static readonly contract = AnnotationAppContract;
// static readonly dependencies = dependencies;
// static create(setup: AnnotationSetup): AnnotationApp;
```

`FeatureSetup` derives the dependency object from the declared tokens: projects
is a `ProjectApp` instance and organizations is an `OrganizationApp` instance.
Technical infrastructure and validated semantic config remain separately typed
inputs. The setup context also supplies feature resource ownership for partial
construction cleanup. App instances expose only their readonly public services;
factory metadata lives on the class, not on those instances.

The framework calls the factory with resolved dependencies, infrastructure,
config and resource ownership. Callers do not assemble another dependency bag
or invoke the factory themselves. Factories may extract complete services from
peer apps to construct their own services; those services do not receive a
root application or a dynamic lookup API.

Type checking rejects access to an undeclared dependency, incompatible factory
inputs, and a result incompatible with the linked app contract. The dependency
map is declared once, with no handwritten mirror of its resolved instance types.
An independently declared static method still needs a parameter annotation:
TypeScript cannot infer that parameter backwards from a later `.withApp(...)`
call. The helper derives this annotation; it does not use reflection or code
generation. It is framework typing machinery, not a partial service view.

Boot validates missing providers, duplicate providers and dependency cycles
before invoking any factory. Type safety cannot prove that a deployment has
installed every required feature. Imports remain subject to architecture lint;
a typed setup parameter alone cannot prevent an undeclared global import.

An interface plus an explicit runtime token could express the same contract.
The abstract contract class keeps those two declarations together. It supplies
no runtime data validation and does not justify forwarding methods or a service
locator. Separate setup/provider calls were rejected because they repeat one
construction decision and allow the two declarations to drift.

### Transport declarations and inferred namespaces

A feature attaches one transport declaration containing an `apis` array. Both
REST and tRPC declarations use the property `router`. They receive the installed
feature app and the standard request context; they declare no extra dependency
bag, app selector or construction callback.

```ts
export const annotationTransport = transport({
  apis: [
    restApi({ router: annotationRestRouter }),
    trpcApi({ router: annotationTrpcRouter }),
  ],
});

export const annotationServer = serverFeature("annotation")
  .withApp(AnnotationApp)
  .withTransport(annotationTransport)
  .build();
```

The helpers preserve each router's required app type. Attaching a transport to
an incompatible app fails type checking. Router declarations remain inert:
route discovery and OpenAPI generation read metadata without constructing the
app or accessing its services. During requests, both protocols use the exact
app constructed at boot. Workers and tasks do not mount API routers.

Domain orchestration and domain collaborators belong behind app services.
Routers own input parsing, actor extraction, transport authorisation, error
mapping and response formatting. Shared authentication and authorisation
machinery comes from the standard process request context. Moving an operation
behind an app service never removes its principal or tenant checks. Ordinary
transport mapping functions need no container registration. The API declaration
has no `dependencies` or `create` escape hatch; a future transport-only resource
requires a separate justified design.

The framework derives the public namespace from the singular catalogue feature
name when attaching the transport. Authors write neither `namespace` nor
`basePath`. REST mounts under the process API prefix `/api/v1`, so annotation
mounts at `/api/v1/annotations`. tRPC uses the same derived `annotations`
namespace. Routers declare relative routes and procedures only. API version
configuration belongs to the process, once.

`FeatureName` is a literal union derived from the ownership catalogue, not an
arbitrary string or an attempt to recognise English singular nouns. The
catalogue remains the authority for singular owners, including established
uncountable names. `serverFeature("annotations")` fails type checking because
that plural is not a catalogue owner.

A template literal type derives `PublicNamespace<F>` from that union. Regular
names need no per-feature namespace mapping. One small central exception table
handles irregular and uncountable domains; both the runtime pluraliser and the
type-level helper consume that table. The following type illustrates the rule:

```ts
type PublicNamespace<F extends FeatureName> =
  F extends keyof NamespaceExceptions
    ? NamespaceExceptions[F]
    : F extends `${infer Stem}y`
      ? F extends `${string}${"a" | "e" | "i" | "o" | "u"}y`
        ? `${F}s`
        : `${Stem}ies`
      : F extends `${string}${"s" | "x" | "z" | "ch" | "sh"}`
        ? `${F}es`
        : `${F}s`;
```

`NamespaceExceptions` is derived from the central exception value, not maintained
as a second table. Examples are `analytics -> analytics` and `presence -> presence`.
Regular examples include `annotation -> annotations`, `query -> queries`,
`gateway -> gateways` and `api-key -> api-keys`. Namespace derivation does not
change lower-kebab spelling or singular feature ownership. Exceptional catalogue
names must be audited explicitly; suffix rules do not understand English.

The inferred namespace remains a literal type through installation, manifests
and client generation. Runtime derivation must agree with the type-level result
for every catalogue owner. Untyped inputs are validated against the catalogue;
namespace collisions fail graph validation before construction or mounting.
Lint rejects handwritten feature namespace overrides, repeated REST prefixes
and the displaced dependency/setup/provider registration chain globally.

This replaces the earlier proposed explicit namespace mapping and repeated
`.withTransportDependencies/.withTransport/.withRest/.withTrpc` assembly. It
keeps feature declarations short without hiding domain dependencies in routers.
The trade-off is maintaining agreement between type and runtime pluralisation,
plus a reviewed exception list for non-regular names.

The user explicitly selected `/api/v1/annotations` as the canonical annotation
REST root. Migration must inventory existing URLs and tRPC names across all
features. Any differing published names require explicit compatibility aliases
at the process migration boundary, with parity coverage; aliases do not become
feature namespace overrides or a second domain implementation. Other endpoint
removals or silent renames are not authorised by this naming convention.

These are accepted target APIs, not claims about the current runtime builder.
The spec marks the new declaration and inference behaviours unimplemented until
runtime, type tests, global lint and process callers adopt them.

### Amendment: one public app per feature (2026-09-07)

Each installer provides one canonical abstract `<Feature>App` from its contract
package, declared in `<feature>.app.ts` and exported from the contract barrel.
The app exposes readonly properties typed as that feature's public abstract
services. Services own behaviour; the app has no forwarding methods, callbacks,
repositories, transport objects or dynamic lookup API. A feature with one
cohesive service exposes one member. Repository count does not justify adding
public services.

The server app factory returns the app itself. `.withApp(AnnotationApp)`
registers that exact object under its linked contract token, without a selector
and without registering its services separately.
REST, tRPC and background contributions use those same service instances in
one process. Dependencies between converted features name their app contracts;
services receive the complete dependencies they actually use. Root applications
are never injected as service locators.

Transport adaptation stays in API-only routers and mapping functions. Domain
collaborators belong behind the app services, not in router dependency bags. A class that enriches responses or extracts actors is not the
public feature app. Browser installation uses browser-safe contracts and the
same feature ownership; it does not import the server graph. The server launcher
reuses process entrypoints and tasks select the services they need without
starting consumers or transports.

This supersedes the canonical-service-only public boundary in ADR-101 and the
strict layout ADR for every catalogue owner, core and Enterprise. Enforcement
starts from `packages/features/catalogue.json`, independently of whether an
installer or contract package already exists. Missing apps, missing required
installers and displaced caller paths are migration failures, not exemptions.
The global command remains red until those owners are migrated; no baseline
hides incomplete adoption.

A server owner requires feature-owned server assembly. Browser-only owners use
browser composition and real browser service contracts, without fabricated
server packages or empty apps. Existing portable browser services, such as
SaasBrowserService, follow the same app grouping convention. Owners without a
contract first establish the portable contract for their existing behaviour.

Migration proceeds through lifecycle corrections, catalogue-wide enforcement,
complete vertical ownership slices, then process-wide graph cutover. Each slice
moves behaviour and callers together, deletes displaced construction, and
preserves URLs, schemas, ordering, errors, principal handling and tenant checks.
Annotation must put its queue workflows behind services and expose the canonical
app on the actual process graph before it serves as the reference for others.
A renamed transport facade is not a completed app migration.

The shared declaration may contain API and worker contributions; boot constructs
only the selected role's contributions, once. Boot is asynchronous so failed
construction waits for cleanup, including resources acquired by partial setup.
Start and stop are idempotent, partial start rolls back, and cleanup continues
through individual failures. Transport contributions unavailable in a role fail
explicitly when requested rather than returning an incorrectly typed value.

Startup migration requirements remain in force. This app migration does not
change authentication behaviour or replace the separately owned identity/SSO
work; their app composition must preserve that work.

### Who hosts what, and who owns what

| Process | Hosts | Owns | Never |
| --- | --- | --- | --- |
| `apps/api` | REST, tRPC, realtime, producer-side dispatch | its own infrastructure, request context, transport security | starts a consumer or a scheduler |
| `apps/worker` | consumers, schedulers, intent execution | the one consumer of each pipeline, drain order | serves a product transport |
| `apps/ui` | browser feature installation, shared session and transport, page composition | the one session and the per-feature transport providers | imports a server installer |
| `apps/server` | the launcher: starts the existing entrypoints and serves the UI artefact | process supervision only | a domain graph of its own |
| `apps/tasks` | one-shot programs | the catalogue entry per task | a long-running listener |

The UI follows the same installation and lifecycle conventions as the server
roles, with browser-safe dependencies.

### The six requirements

Each requirement below names the guard that enforces it **today**, or says
**no guard yet**, and names the guard **proposed**.

**1. Feature-owned assembly.** The installer constructs its repositories, its
collaborators and its canonical service. Process roots choose implementations
and configuration and contain no domain queries, no mappers and no duplicate
services.

- Guard today: `feature-source-layout` and `feature-source-subject`
  (`packages/lint-core/src/rules/`) fix where a feature's own sources live;
  `service-dependencies` stops a service importing a foreign repository;
  `composed-exports` (`packages/architecture-lint/src/composed-exports.ts`)
  refuses an exported service no root constructs.
- Guard proposed: `no-domain-query-in-composition` — a Prisma delegate call, a
  mapper, or a `create` of another feature's repository inside a
  `*.composition.ts` or an app root fails.

**2. Complete dependencies.** Abstract app contracts are peer dependency
tokens; named infrastructure ports remain explicit technical dependencies.
Missing, duplicate and cyclic providers are rejected before readiness.
There is no request-time service locator, no partial service view, and no
automatically generated throwing proxy. A deliberately disabled feature exposes
an explicit disabled capability state.

- Guard today: `global-app-access` (`packages/architecture-lint/src/global-app-access.ts`)
  bans `getApp`; `service-dependencies` bans callback bags and `Pick`/`Omit`
  service views. Nothing validates the graph at boot: absence is discovered by
  the first request, via one of the 53 `refusing*` fallbacks.
- Guard proposed: boot-time validation in the container (`MissingProviderError`,
  `DuplicateProviderError`, `DependencyCycleError`, each naming feature, key and
  token), plus `port-is-abstract-class` — a dependency token that is a type
  alias or a member-less class fails.

**3. One registration source.** Each selected feature contributes routes, jobs
and lifecycle hooks through its installation declaration. Runtime manifests
derive from those declarations. `packages/features/catalogue.json` stays the
ownership authority; there is no competing catalogue.

- Guard today: `feature-catalogue` (`packages/architecture-lint/src/feature-catalogue.ts`)
  and `manifests` hold the catalogue as the authority; the one-list convention
  is documented in `dev/docs/best_practices/feature-installation.md` and
  `no-raw-hono-mount` (`packages/lint-core/src/rules/`) refuses a hand-rolled
  route registration.
- Guard proposed: `app-with-feature-only` — no `*.composition.ts` under `apps/**`
  outside the one app root per application; manifests derived from declarations
  rather than restated.

**4. Consistent roles.** As in the table above.

- Guard today: `application-boundaries` and `frontend-ui-boundaries`
  (`packages/architecture-lint/src/`) keep browser packages out of server
  entrypoints; `eventing-roles` fixes producer versus consumer;
  `dev/scripts/check-node-resolution.mjs` proves each process's real boot graph
  resolves under node's own resolver. `apps/api`'s producer-only Eventing is
  pinned at `apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts:104`.
- Guard proposed: a role assertion in `boot({ role })` — a feature contributing
  a consumer to the `api` role fails boot, rather than relying on
  `consumersEnabled: false` being passed correctly at one call site.

**5. Shared authorization semantics.** REST and tRPC preserve the same
credential principal and authorize the actual affected scopes. Transport
adaptation never turns a restricted key into its owner and never bypasses a
service-level ownership check.

- Guard today: `api-transport-boundaries` and `api-context-services`
  (`packages/lint-core/src/rules/api-context-services.rule.mjs`), the tRPC
  declared-check middleware chain, and the fail-closed backstop described in
  `feature-installation.md`. Enforcement is per transport; nothing asserts the
  two transports reach the same policy for the same operation.
- Guard proposed: a policy-parity test over the declared operations — every
  operation exposed on both doors resolves to one policy and one principal.

**6. Predictable shutdown.** Stop accepting work; stop fetching jobs; drain
in-flight work while producers remain available; then close transports and
infrastructure. Owned resources close once, in reverse dependency order. A
failed boot cleans up everything it already acquired.

- Guard today: `ResourceScope` and `GracefulShutdown`
  (`packages/runtime-composition/src/`), proven for the worker in
  `apps/worker/src/app/__tests__/worker.application.unit.test.ts`.
- Guard proposed: the same lifecycle owned by the container for every role, so
  the API and tasks get the ordering the worker already has.

### Enterprise direction is unchanged

Core never imports an Enterprise implementation. `manifests.ts:183` carries the
`enterprise-direction` policy and it stays as it is; Enterprise features
register through the same `withFeature` declaration inside a branch the
compiler cannot see, which is why boot validation is the authority and the type
is the early warning.

## System migrations: one framework, two modes

A migration is either blocking at startup or incremental in the background.
Both run on one framework; the mode is a property of the migration.

```
  STARTUP MODE — the process does not serve until the work is finalized
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ validate     │──▶│ open         │──▶│ complete     │──▶│ construct    │──┐
  │ config +     │   │ migration    │   │ REQUIRED     │   │ services     │  │
  │ declarations │   │ infrastructure│  │ blocking     │   │              │  │
  └──────────────┘   └──────────────┘   │ migrations   │   └──────────────┘  │
                                        └──────────────┘                     │
                     ┌──────────────┐   ┌──────────────┐                     │
                     │ ready        │◀──│ start        │◀────────────────────┘
                     │              │   │ transports + │
                     └──────────────┘   │ consumers    │
                                        └──────────────┘
    failure, incomplete work, or operator intervention at step 3
    ⇒ readiness never opens; the replica stays out of the load balancer
```

```
  BACKGROUND MODE — the process serves throughout
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ start        │──▶│ migrate      │──▶│ verify       │──▶│ switch       │──▶│ retire       │
  │ COMPATIBLE   │   │ incrementally│   │ convergence  │   │ reads +      │   │ old storage  │
  │ application  │   │ + persisted  │   │              │   │ writes       │   │              │
  └──────────────┘   │ checkpoints  │   └──────────────┘   └──────────────┘   └──────────────┘
                     └──────────────┘
                            ▲    │
                            └────┘  a restart resumes from the checkpoint,
                                    never from the beginning
```

Rules that hold across both modes:

- Stored objects use **startup** mode. The move is one-way and completes before
  traffic or consumption.
- Replicas coordinate through the existing durable migration lease and state
  (`packages/system-migrations/src/lease.repository.ts`,
  `state.repository.ts`). A blocking migration therefore holds **every** replica
  out of readiness until it is finalized, not merely the one holding the lease.
- Failure, incomplete work, or operator intervention blocks readiness.
- Incompatible writers are stopped or fenced before the switch.

**Why awaiting the current helper is not enough.**
`driveSystemMigrationsToConvergence`
(`packages/system-migrations/src/convergence.ts:59`) catches every pass failure
(`passOrNull`, `:95`, `catch` at `:106`) and returns when a pass advanced
nothing (`converged`, `:125`). Both behaviours are correct for a background
loop and wrong for a gate: the helper can return with tenants parked, claimed by
another process, or merely not yet finalized, and a caller that awaits it learns
nothing about completion. Startup mode needs an explicit completion assertion —
every tenant in the cohort finalized — not the absence of movement.

Auth's own migration keeps its separate PR and is out of scope here.

## Enforceable code requirements

Each maps to the tool that enforces it. Baselines are never raised for new
violations.

| Requirement | Enforced by |
| --- | --- |
| **One owner, no duplicate implementation.** Features own business logic; API, UI, worker and server compose surfaces. | architecture-lint (`feature-catalogue`, `composed-exports`, `legacy-feature-fragments`) |
| **Construct once.** Concrete services have private constructors and `static create`. No construction in handlers, no global app access, no import-time registration. | oxlint (`service-classes`, `feature-module-classes`), architecture-lint (`global-app-access`) |
| **Inject complete contracts.** No callback bags, service locators, `Pick`/`Omit` service views, mirrored signatures, or foreign repositories. | oxlint (`service-dependencies`) |
| **Keep boundaries typed.** Zod validates transport, persistence and process inputs. No `any`, double assertions, suppression comments, or assertions standing in for validation. | oxlint (`typed-prisma-seam`, `no-inferable-twin` proposed), focused typechecks |
| **Keep infrastructure private.** Generated Prisma stays inside repository adapters; roots parse the environment once and inject semantic configuration. | oxlint (`prisma-containment`, `environment-boundaries`), architecture-lint (`typed-prisma-seam`) |
| **Keep methods predictable.** Return a value or throw a concrete domain error. Absence is `find*` returning `null`. `require*` is forbidden. | oxlint (`fallible-result-naming`) — **the rule still enforces the OLD `try*` convention** (`packages/lint-core/src/rules/fallible-result-naming.rule.mjs:72`). Alex ruled on 2026-09-06 that `try*` is banned and absence is `find*`; the rename is in progress across 678 declarations in the rule's scope, and the rule flips to `find*` when it lands |
| **Keep composition declarative.** No SQL, authorization decision, business mapping, transaction, or request handling inside a composition module. | architecture-lint (`no-domain-query-in-composition`, proposed) |
| **Keep authorization consistent.** Preserve the credential principal, check the target being accessed, share policy between transports. | oxlint (`api-context-services`), architecture-lint (`api-transport-boundaries`), policy-parity test (proposed) |
| **Keep source readable.** Lower-kebab filenames with dotted roles, small cohesive collaborators, braces, named intermediate values, short comments explaining durable constraints. | oxfmt, oxlint (`feature-source-filename`, `service-member-spacing`, `comment-block-size`), architecture-lint (`service-ceilings`, `comment-blocks`) |
| **Keep eventing deterministic.** Projections and process managers derive synchronously; effects run behind explicit retry and idempotency boundaries. | architecture-lint (`eventing-roles`, `service-projection-boundaries`) |
| **Preserve behaviour and coverage.** Delete displaced implementations after rewiring callers; keep equivalent behavioural coverage and existing API contracts. | architecture-lint (`check-feature-parity`, `test-quality`), focused tests |

## Done means

- The old assembly paths are removed.
- Every enabled dependency is validated before readiness.
- All process roles follow the same installation and lifecycle rules.

Existing URLs, tRPC procedure names, response shapes and process topology stay
intact. Router renaming, removing `apps/tasks`, and runtime Prisma
table-ownership enforcement are separate decisions and are not decided here.

## Gap table

| # | Requirement | Current state in code | Guard today | Guard proposed | Hours |
| --- | --- | --- | --- | --- | --- |
| 1 | Feature-owned assembly | `apps/api/src/app/api-production.composition.ts:844` `compose()` and 30 private `compose*`/`resolve*` methods to `:4324`; 130 `*.composition.ts` files, 36,981 lines | `feature-source-layout`, `service-dependencies`, `composed-exports` | `no-domain-query-in-composition`; container-owned construction | 120 |
| 2 | Complete dependencies | `api-production.composition.ts:1464` `optionalPorts()`; 53 `refusing*` fallbacks, 101 `*UnavailableError`, 50 `Logged*Absence` (`:4386`–`:4668`) | `global-app-access`, `service-dependencies` — nothing validates the graph at boot | boot-time `MissingProviderError` / `DuplicateProviderError` / `DependencyCycleError`; `port-is-abstract-class`; one explicit disabled state | 60 |
| 3 | One registration source | `apps/api/src/app-rest/app-rest.features.ts`, `apps/api/src/app-trpc/app-trpc.features.ts`, `apps/worker/src/features/worker-feature.installer.ts`, `apps/tasks/src/tasks.catalogue.ts` — four lists, one per transport | `feature-catalogue`, `manifests`, `no-raw-hono-mount` | `app-with-feature-only`; manifests derived from declarations | 40 |
| 4 | Consistent roles | `apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts:104` sets `consumersEnabled: false` at one call site; `apps/worker/src/app/worker-production.composition.ts:396` is the only consumer | `application-boundaries`, `frontend-ui-boundaries`, `eventing-roles`, `check-node-resolution.mjs` | role assertion in `boot({ role })` | 24 |
| 5 | Shared authorization semantics | policy chain exists once per transport; no cross-transport assertion | `api-transport-boundaries`, `api-context-services`, declared-check middleware | policy-parity test over operations exposed on both doors | 24 |
| 6 | Predictable shutdown | `packages/runtime-composition/src/resource-scope.ts`, `graceful-shutdown.ts`; ordering proven for the worker only (`apps/worker/src/app/__tests__/worker.application.unit.test.ts:232`) | `ResourceScope` + worker unit tests | container-owned lifecycle for every role, including a failed boot | 32 |
| 7 | System migrations, startup mode | `packages/system-migrations/src/convergence.ts:59` catches failures (`:106`) and returns on no-movement (`:125`); background mode only | runner and convergence unit tests | explicit completion assertion gating readiness; startup mode for stored objects | 40 |

## Deployment Impact

None while the container wraps the existing graph: same features, same boot,
same topology. Two later stages change runtime behaviour on purpose, and each
needs its own note when it ships.

- Boot validation turns a missing dependency from a first-request 500 into a
  refused boot. A deployment that has been running on an unnoticed refusing
  fallback will fail to start until it is configured or the feature is
  explicitly disabled.
- Startup-mode migrations gate readiness. A replica whose blocking migration has
  not finalized stays out of the load balancer, which is the intent, and which
  makes migration duration a rollout-time concern.
