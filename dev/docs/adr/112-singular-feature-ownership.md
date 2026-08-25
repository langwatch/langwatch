# ADR-112: Product domains use singular feature ownership

**Date:** 2026-08-24

**Status:** Accepted

**Supersedes:** The local `feature.json` ownership-expansion mechanism in
architecture-lint ADR-001 and Governance ADR-001. It also relocates the
accepted Admin package-boundary decision from its temporary Enterprise root
without changing its behavioural contract. SaaS remains in the Enterprise
source-license tree. ADR-101 is
amended in the same decision so its feature examples and scope are singular and
catalogue-backed. The physical contract/server/web surfaces and strict layout
from those decisions remain in force.

**Behavioural contract:**
[Singular feature ownership](../../../specs/dependencies/singular-feature-ownership.feature)

**Related:** [ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md),
[ADR-111: physical application workspaces](./111-physical-application-workspaces.md),
[feature-package boundary ADR](../../../packages/architecture-lint/adrs/001-feature-package-boundaries.md),
and
[strict source-layout ADR](../../../packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md).

## Context

The application has accumulated several competing notions of a boundary. A
URL, tRPC router, Prisma table, application folder, Eventing pipeline, and
Enterprise directory can each look like a feature even when they describe the
same product capability. The result is duplication at both extremes: small
behaviours such as a user avatar risk becoming standalone services, while broad
names such as Governance can acquire project, workspace, virtual-key, AI-tool,
CLI-session, and administration implementations that already have natural
owners elsewhere.

The strict feature layout says how a feature package is structured, but it does
not yet decide what is large enough to be a feature or mechanically identify
which feature owns a product subject. A local `subjects` array makes accidental
new filenames visible, but a package can still claim an adjacent subject by
editing its own manifest. That is insufficient to prevent a broad package from
becoming a second application layer.

The inverse failure would be a package per endpoint or table. User avatars,
prompt tags, dataset records, project-scoped routes, and legacy URL prefixes do
not each justify a separately composed service. Too many tiny packages would
replace the monolith with ceremony without creating useful isolation.

Cross-feature use cases also need one implementation. A Governance handler that
needs a project must use the canonical Project service; it must not define a
`GovernanceProjectService`, a second project repository, or a caller-specific
projection of project behaviour. The application needs one composed instance
of each service for the process, not a global Prisma shortcut or a fresh object
graph on every request.

Finally, Enterprise is first a source-license and composition boundary, not a
claim that every package has the same runtime entitlement gate. SaaS-only
vendor integrations are governed by the Enterprise source license even when
deployment selection, rather than an Enterprise plan entitlement, activates
them. Platform administration and operational tooling are available to every
installation and do not belong beneath that source-license boundary.

## Decision

### A feature is a singular product capability

Feature ownership roots use a singular lower-case kebab-case product noun. A
feature is justified by an independently meaningful lifecycle, permission
boundary, durable model, public capability, or runtime responsibility. A route,
table, screen, provider adapter, or one-off workflow is not sufficient by
itself.

The initial core catalogue contains the following independently owned domains:

| Feature          | Representative ownership                                                                |
| ---------------- | --------------------------------------------------------------------------------------- |
| `agent`          | agent definitions and execution-facing product behaviour                                |
| `analytics`      | analytical query execution, query vocabulary, and reusable analytical read models       |
| `annotation`     | annotation and score lifecycle                                                          |
| `api-key`        | API credential issuance, rotation, restriction, and revocation                          |
| `auth`           | authentication, login, identity-provider, and session behaviour                         |
| `authz`          | permissions, grants, bindings, and authorization decisions                              |
| `automation`     | automation definitions and execution lifecycle                                          |
| `coding-agent`   | coding-agent conversations and jobs                                                     |
| `dashboard`      | dashboards, graphs, saved workbench charts, and chart ordering                          |
| `data-privacy`   | scoped capture, redaction, and privacy policy                                           |
| `data-retention` | retention policy, pinning, metering, and retroactive work                               |
| `dataset`        | datasets, records, imports, and dataset file handling                                   |
| `entitlement`    | provider-neutral plan and capability decisions                                          |
| `evaluation`     | evaluation definitions, runs, and results                                               |
| `evaluator`      | evaluator definitions, execution, and evaluator providers                               |
| `experiment`     | experiment definitions and execution history                                            |
| `gateway`        | AI gateway policy, virtual keys, budgets, cache rules, and guardrails                   |
| `github`         | GitHub installations, webhooks, repositories, and pull-request linkage                  |
| `langy`          | Langy conversations, signals, and jobs                                                  |
| `model-provider` | provider credentials, models, model metadata, and model costs                           |
| `monitor`        | online monitor definitions and lifecycle                                                |
| `notification`   | user-facing notification delivery and preferences                                       |
| `ops`            | backoffice administration, queues, replay, schedulers, and event/process operations     |
| `organization`   | organizations, teams, groups, memberships, invites, and personal-workspace provisioning |
| `project`        | project lifecycle, settings, and project identity                                       |
| `role`           | custom-role definitions and assignment policy                                           |
| `prompt`         | prompts, versions, tags, and prompt configuration                                       |
| `presence`       | collaborative user presence and cursors                                                 |
| `scenario`       | scenario definitions and scenario lifecycle                                             |
| `secret`         | project secret lifecycle and reserved-name policy                                       |
| `simulation`     | simulation execution and batches                                                        |
| `stored-object`  | durable object metadata, upload, delivery, and migration                                |
| `suite`          | suite definitions, run plans, and suite run history                                     |
| `telemetry`      | standards-compliant telemetry ingestion and collection                                  |
| `topic`          | topic models, clustering runs, and clustering status                                    |
| `trace`          | traces, spans, sharing, overlays, and trace querying                                    |
| `user`           | user lifecycle, profile, preferences, deactivation, and avatar                          |
| `workflow`       | workflow definitions, versions, nodes, and execution-facing behaviour                   |

The catalogue is an ownership map, not a requirement to create empty packages.
A package is created only when its vertical slice is migrated. The catalogue
may grow as the remaining application inventory reveals a durable product
domain, but a new entry is an architectural decision rather than an incidental
folder creation.

Subordinate concepts stay with their owning feature. In particular, user avatar
belongs to `user`; teams, groups, invites, and memberships belong to
`organization`; dataset records belong to `dataset`; prompt versions and tags
belong to `prompt`; trace spans, shares, edit overlays, and saved trace views
belong to `trace`; and graphs and saved workbench charts belong to `dashboard`.
Existing URL shapes do not alter that ownership. Compatibility routes such as
`/user` and `/user/avatar` may coexist and delegate to the same User service
until a future versioned API changes them.

Related product nouns remain separate when callers can use one without owning
the other's lifecycle. Evaluations and evaluators, scenarios and simulations,
projects and API keys, Analytics and Dashboard, and Coding Agent and GitHub
therefore have separate contracts even when an API operation composes them.

### The catalogue is the ownership authority

`packages/features/catalogue.json` is the repository-wide source of truth for
core and Enterprise feature identities, roots, classifications, and owned
subjects. Every subject has exactly one owning feature. A feature's
`feature.json` continues to select its strict layout version but cannot broaden
ownership locally.

Architecture lint verifies that:

- every governed feature root is registered and its directory equals its
  singular catalogue identifier;
- every registered root exists once it contains a migrated surface;
- package names derive from the registered identifier and surface role;
- each production module subject belongs to that feature in the catalogue;
- no subject is owned by two features;
- source and emitted declarations do not expose a service, repository, store,
  adapter, or schema named for another feature's subject; and
- catalogue expansions are accompanied by the owning feature ADR and
  behavioural specification.

The catalogue makes an expansion reviewable and the linter prevents a local
manifest edit from silently legalising it. It does not attempt English
pluralisation or infer product design from filenames.

### The service contract is the cross-feature boundary

Each feature contract exposes its portable Zod 4 values and one canonical
abstract service capability for ordinary consumers. A second public service is
justified only by a materially different trust or runtime lifecycle and must be
recorded in the feature ADR. Repository, store, projection, database, and
provider-specific ports remain private to the owning server package.

One feature may use several private repositories when it truly spans several
stores, but repository count does not determine service count. Reads, history,
commands, and lifecycle operations for the same product capability belong on
the one service. Existing parallel services and repositories are merged while
the feature moves when the result is a smaller, coherent boundary; unrelated
lifecycles are not forced together merely to reduce a count.

A feature that needs another feature imports that feature's contract and
receives its service. It does not import the other feature's server package,
construct a parallel repository, copy its schema, or publish a caller-prefixed
version of the service. A cross-domain operation lives on the feature that owns
the initiating lifecycle and collaborates with the other services. If there is
no truthful owner, the application composition root may orchestrate the call;
that does not justify a catch-all shared feature.

The API and worker composition roots construct one canonical service graph per
process. Hono receives it as `c.var.langwatchApp`; tRPC receives the same graph
as `ctx.app`; worker handlers receive it from their composed runtime. Transport
handlers do not construct services per request, and service decisions do not
reach a global Prisma client.

### Core and Enterprise ownership are distinct

`ops` is a core feature under `packages/features/ops`. It absorbs the current
platform-operations implementation and the platform-admin/backoffice code now
under `packages/features/ops`. Admin routes and UI names may remain
as compatibility transports, but there is no standalone `admin` feature and no
Enterprise entitlement gate for this behaviour.

`saas` remains an Enterprise-classified feature under
`packages/enterprise/features/saas`. Its third-party analytics, support, and
hosted-deployment integrations are governed by the Enterprise source license.
SaaS deployment selection is distinct from an Enterprise entitlement check,
but that activation distinction does not relicense the implementation source.

The Enterprise feature catalogue consequently contains only genuinely
Enterprise-owned domains: `audit-log`, `billing`, `governance`, `licensing`,
`managed-provider`, `saas`, `scim`, `sso`, and `webhook`. Enterprise
composition may consume core contracts and install compatible Enterprise
extensions, but the portable Enterprise catalogue does not claim `ops`.

Governance owns governance policy and ingestion behaviour: ingestion sources
and pulls, OTTL policy, anomaly rules, departments and cost attribution,
quarantine, governance delivery, and the governed AI-tool catalogue lifecycle.
It does not own project, user, personal workspace, virtual-key, or
model-provider implementations. Those move to their core owners and Governance
consumes the canonical service contracts where required, including Model
Provider when building governed tool choices.

### Migration remains vertical and behaviour-preserving

The application inventory is migrated in dependency order:

1. land the catalogue and ownership lint before more feature source moves;
2. correct existing roots to singular names, including `agent`, `entitlement`,
   `stored-object`, `managed-provider`, and `webhook`, and remove the unfinished
   plural `projects` scaffold in favour of `project`;
3. preserve SaaS in the Enterprise source-license tree and merge Enterprise
   Admin plus existing operational tooling into core `ops`;
4. extract the identity spine: `auth`, `authz`, `user`, `organization`,
   `project`, and `api-key`;
5. extract independently owned product resources beginning with
   `model-provider`, `prompt`, and `dataset`, followed by the remaining
   catalogue in dependency order;
6. extract the observability spine from Telemetry through Trace, then its
   Annotation, Data Retention, Data Privacy, Analytics, Dashboard, and Topic
   consumers;
7. extract platform products including Gateway, GitHub, Coding Agent, Langy,
   Automation, Notification, and Presence; and
8. finish the physical `apps/ui`, `apps/api`, and `apps/worker` split only after
   their reusable behaviour belongs to features.

Each vertical move includes contract, server, optional web, tests, ADR/spec,
runtime construction, and compatibility route rewiring. The monolith remains
runnable between moves. Existing endpoints, tRPC names, images, commands,
deployment topology, and persisted data do not change merely because ownership
moves.

## Alternatives considered

A package per endpoint or table was rejected because it creates composition and
manifest overhead without an independent product lifecycle. User avatar is
part of User even though it has a distinct route and persistence details.

Large thematic packages such as Identity, AI Configuration, Observability, or
Governance-everything were rejected as implementation ownership. They are
useful roadmap categories, but they permit unrelated services and repositories
to accrete behind a broad name and make cross-feature dependencies invisible.

Allowing callers to define narrow copies such as `GovernanceProjectService`
was rejected because every copy becomes another source of validation,
transaction, caching, and authorization behaviour. Narrow consumption is
achieved through methods on the canonical Project service contract instead.

Keeping Admin under Enterprise was rejected because the generally available
backoffice capability is not Enterprise source. Moving SaaS out of Enterprise
was rejected for the opposite reason: its hosted-deployment integrations are
Enterprise-licensed source even though they are selected by deployment mode
rather than one uniform entitlement gate.

Inferring ownership from filenames without a catalogue was rejected because
singularity and domain meaning are not mechanically derivable from English.
The explicit catalogue is small, reviewable, and gives lint a deterministic
authority.

## Consequences

- Product domains have one singular, searchable ownership root.
- Endpoint compatibility no longer creates duplicate feature implementations.
- Broad packages cannot claim adjacent subjects through a local manifest edit.
- Cross-feature behaviour uses one composed service implementation and one
  persistence owner.
- Admin and operational tooling become available core behaviour; SaaS remains
  governed by the Enterprise source license.
- Existing plural package names require coordinated import, manifest, lockfile,
  Docker, CI, ADR, and spec migrations.
- The catalogue requires deliberate maintenance when a genuinely new product
  domain appears.
- Physical app extraction becomes simpler because routes and workers compose
  feature services instead of owning business behaviour.
