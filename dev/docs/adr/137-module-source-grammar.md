# ADR-137: A module's source layout is a grammar, not a convention

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: the class rules are one rule, and the
boundary rules the deleted package-and-layer ADR recorded live here (see the last section).

**Behavioural contract:**
[Filenames](../../../specs/tooling/lint-feature-source-filename.feature),
[layout](../../../specs/tooling/lint-feature-source-layout.feature),
[subjects](../../../specs/tooling/lint-feature-source-subject.feature),
[module classes](../../../specs/tooling/lint-module-classes.feature),
[pass-through classes](../../../specs/tooling/lint-pass-through-class.feature),
[namespace classes](../../../specs/tooling/lint-namespace-class.feature),
[schemas in the contract](../../../specs/tooling/lint-schema-outside-contract.feature),
[HandledError in the contract](../../../specs/tooling/lint-handled-error-outside-contract.feature),
[strict feature layout](../../../packages/architecture-enforcer/specs/strict-feature-layout.feature),
[source folder shape](../../../packages/architecture-enforcer/specs/source-folder-shape.feature)

**Related:** [ADR-112: singular feature ownership](./112-singular-feature-ownership.md),
[ADR-133: the composition spec](./133-composition-spec.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-135: the toolchain](./135-lint-and-format-toolchain.md)

## Context

There are around fifty modules. A reader who has to learn where things live in
each of them learns nothing transferable, and an agent asked to add an endpoint
guesses, which is how a repository ends up with `utils/`, `helpers/`,
`lib/`, `common/` and four spellings of the same file.

The grammar is the alternative: one filename shape, `<subject>.<artifact>.ts`
in lower kebab case, from a closed list of artifacts; one home for each kind of
artifact under `server/src/`; one subject owned by one module; and a small set
of class shapes with the same meaning everywhere - a service is one `*Service`
class with a `static create`, a port is one abstract `*Port` class, a runtime
module exports the concrete class.

Two of the rules here are about what the grammar is *not* allowed to become.
A class whose methods forward under the same name to the same collaborator is
a hop the reader pays a file for. A class whose every member is static is a
module that put a class on. Both look like architecture and are cost without
structure.

The folder budgets are the same argument at the directory level: a folder with
thirty files in it cannot be held in mind, and a two-line file that only its
one neighbour reads is a hop too.

## Decision

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/feature-source-filename` | plugin | `<subject>.<artifact>.ts`, lower kebab case, artifact from the canonical list. |
| `langwatch/feature-source-layout` | plugin | Six ids covering where a file may live in layout v0, contract filenames, server artifacts in contract source, a process manager written as a service, and rules-module purity. |
| `langwatch/feature-source-subject` | plugin | A module may not claim a subject the catalogue gives to another module. |
| `langwatch/module-classes` | plugin | A service, app, migration or repository module exports its concrete class, built through `static create` behind a private constructor; a declared interface file exports the interface; no behaviour in a standalone export. Replaces `feature-module-classes`, `service-classes` and `service-quality` (2026-09-23). |
| `langwatch/pass-through-class` | plugin | A class whose public methods almost all forward under the same name to the same collaborator is a hop, not a layer. Was `layer-class`. |
| `langwatch/namespace-class` | plugin | A class with only static members is a module wearing a class. |
| `langwatch/schema-outside-contract` | plugin | A Zod schema authored (not merely composed from an import) as a top-level const in `process/src/transport/**` belongs in the module's contract package. |
| `langwatch/handled-error-outside-contract` | plugin | A class extending `HandledError` declared anywhere under a module's `process/src` belongs in `contract/src/<m>.errors.ts`. |
| `feature-layout` | architecture-enforcer | A server file outside the folder-and-kind grammar, or a root exporting a private repository, store or projection. |
| `feature-shape` | architecture-enforcer | A module carrying a legacy pre-ADR-133 shape fragment. |
| `source-folder-shape` | architecture-enforcer | Folder and fragment budgets: at most 12 files in a source folder, no sub-20-line fragment only one neighbour reads. |
| `unused-module-export` | architecture-enforcer | A name a module's `server` package exports that no file in the repository imports, the package index included. |
| `memory-twin-drift` | architecture-enforcer | A repository whose Prisma implementation and memory twin declare different method sets, in either direction. |

`feature-app-contract` and `feature-setup-infrastructure` were retired on
2026-09-23: they enforced the module `*App` shape ARCHITECTURE.md §15 deletes.

The per-file half is the plugin, because it needs the file's classified role
and layout version. The per-module half is architecture-enforcer, because it needs
the catalogue, the manifests and the whole tree of a module at once. Neither
half can be expressed in oxlint configuration at all.

## Amendment, 2026-09-15: event sourcing is one folder, not six

The grammar always named `eventing/<subject>.<kind>.ts` and always allowed eight
kinds under it -- `events`, `commands`, `schemas`, `projection`, `subscriber`,
`process`, `intent`, `store` -- but around fifty modules still kept those artifacts
in free-standing `projections/`, `intents/`, `processes/`, `subscribers/` and
`stores/eventing/` folders, which the grammar did not name at all. 259 files moved
into `eventing/` and 528 import specifiers followed them; the emptied folders are
deleted. `feature-source-layout` fell by 133 and the whole oxlint total fell by
102, typecheck unchanged at its 114-error baseline across the same 40 files.

Two consequences are worth recording because neither is obvious:

**A path-keyed baseline does not survive a rename, and it fails silently.**
The move appeared to add 208 findings across `stand-in-cast` (98),
`test-description-is-an-action` (23), `shared-setup-is-a-hook` (17),
`cognitive-complexity` (12), `temporal-only` (5) and others. None of it was real.
Every one of those rules reads the shrink-only register, whose rows are keyed
`rule|path`, and 325 of those rows named a path that had just stopped existing.
A row that matches nothing does not announce itself -- the rule simply reports
debt that was already measured and accepted, as if it were new. Re-keying the
rows to the moved paths (and re-sorting the register, which the rename had put
out of codepoint order) returned every one of those rules to its pre-move count.
The lesson is the rename discipline: **moving a file is also an edit to every
baseline that names it**, and the only signal you get otherwise is a count that
went up for no stated reason.

**The layer table is keyed by folder, so one folder cannot mean eight things.**
`repository-takes-only-its-store` reads `LAYER_MAY_TAKE`, whose rows are folder
names. While stores sat in `stores/` -- a folder absent from the table -- a
repository naming its store was allowed by accident rather than by decision. Under
`eventing/` the same import reads as a crossing into the eventing pipeline, and the
rule named after letting a repository take its store began refusing exactly that.
The exemption is narrow and lives in `crossingFor`: a repository may name an
`eventing/*.store.ts` and nothing else in that folder. A projection, process,
subscriber, intent or pipeline is still a crossing, and 22 such imports now
report. These are the move's only genuine new findings -- pre-existing coupling
that was invisible because it lived in folders the layer table never named.

## Consequences

The grammar is what makes the module skills work: `module`, `module-review` and
`feature-convert` can state where a file goes because a rule refuses every other
answer, and `dev/docs/lint-rules.md` renders the sentence the rule prints.

Six of these policies are ratchets rather than rules - `feature-shape`,
`source-folder-shape`, `legacy-feature-fragments`, `unused-module-export`,
`infrastructure-member-unused` and `memory-twin-drift` each carry a baseline of
existing violations. That is deliberate: the grammar arrived after the code,
and a rule that fails 431 folders on day one is a rule somebody turns off. The
ratchet holds the line and the count only goes down.

`service-quality` is registered and enabled nowhere, and its duplicate-member
half duplicates the available built-in `no-dupe-class-members`. ADR-135 records
both facts as follow-ups.

## Amendment, 2026-09-23: the boundary rules

The package-and-layer-boundaries ADR (numbered 136 until its deletion on
2026-09-18) recorded these rules and was retired in favour of
`dev/docs/ARCHITECTURE.md`, which is the authority on the shape. The rules that
enforce that shape are recorded here. `legacy-feature-fragments` and
`infrastructure-member-unused` were deleted, and `feature-shape` no longer
reads a baseline.

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/package-boundaries` | plugin | The dependency direction: apps to process or browser to contract, one module reaches another only through its contract, a browser package is closed, a kit is a leaf that fetches nothing, and a package is imported only through its `exports`. One message id per shape. |
| `langwatch/module-layers` | plugin | Inside a module, a repository, channel, transport or service names only what its layer may: a channel takes its client, a transport names no repository, service or channel (it calls the `app` it receives), a service names no repository backend and no channel implementation. Replaces `service-dependencies`, `transport-imports-a-repository`, `repository-takes-only-its-store` and `channel-takes-only-its-client`. |
| `langwatch/web-imports-server-shaped-value` | plugin | A browser module may not value-import a package whose declarations are the server's. |
| `langwatch/service-does-not-open-a-channel` | plugin | A file under `services/` may not construct the event bus or a queue processor (`EventSourcing`, `mapCommands` and the other eventing runtime constructors; helpers, errors and types are free), Redis pub/sub, an HTTP client, an AWS client, a mail sender or Slack; the conduit is a channel and the service takes its interface. |
| `langwatch/rest-route` | plugin | A REST declaration imports its schemas from its own contract, declares input and output, keeps path parameters semantic, and answers by returning or throwing, never by building a response. Replaces the six `rest-*` rules. |
| `langwatch/no-port-vocabulary` | plugin | No `*Port` name and no `ports/` path: state is a repository, an exchange is a channel, behaviour is a service. |
| `langwatch/legacy-monolith-path` | plugin | No `~/*`, `@app/*` or `platform/` specifier; nothing maps them any more. |
| `langwatch/no-alias-reexport` | plugin | A name is re-exported under its own name, not an alias. |
| `langwatch/unresolved-relative-import` | plugin | A relative import or re-export resolves to a file that exists. Was `dangling-barrel-export`. |
| `langwatch/jsx-from-hook` | plugin | A hook returns state and callbacks, not JSX. |
| `langwatch/signature-mirror` | plugin | A boundary signature does not mirror another type through `Parameters`/`ReturnType`; the nested-cast half is `stand-in-cast`. Was the `boundary-signature-mirrors` policy. |
| `langwatch/enterprise-license-header` | plugin | Every `enterprise/` source file carries its licence header. Was the `enterprise-source-license` policy. |
| `application-boundaries` | architecture-enforcer | One application may not import another's source. |
| `cycles` | architecture-enforcer | No circular manifest dependency among workspace packages. |
| `manifests` | architecture-enforcer | Every manifest declares an explicit `exports` map, no private or accidental entry point, no cross-application dependency. |
| `declarations` | architecture-enforcer | A package's public `.d.ts` does not leak Prisma, application source or private repository types. |
| `composed-exports` | architecture-enforcer | A process package does not export a factory no application entrypoint constructs. |
| `declaration-project-references` | architecture-enforcer | Declaration-project references do not cycle, dangle, or drift from the manifest. |
| `contract-build-config` | architecture-enforcer | A contract package's declaration build is configured, and src-only. |
| `langwatch/transport-declares` | plugin | A transport handler reaches no raw request or response context and goes through `@langwatch/api`, validating output. Was the `api-transport-boundaries` and `api-transport-framework` policies. |
| `service-projection-boundaries` | architecture-enforcer | A service does not depend on a collaborator exposing projection-store writes. |
| `langwatch/eventing-role-purity` | plugin | A projection, subscriber or process manager stays inside its role: no I/O, no awaiting, no fabricated durable events. Was the `eventing-roles` policy. |
| `architecture-records` | architecture-enforcer | Every non-application ownership root owns a boundary ADR with the required sections and at least one spec. |
| `feature-configuration` | architecture-enforcer | Two applications do not each bind the same environment variable through their own config schema. |
| `browser-node-leak` | architecture-enforcer | A browser-reachable package's value-import graph does not reach a Node builtin. |
| `browser-package-closure` | architecture-enforcer | Nothing but `apps/ui` imports a module's browser package or declares it as a dependency. |
| `browser-package-exports` | architecture-enforcer | A browser package exports `./declaration` and nothing else. |
| `browser-kit-exports` | architecture-enforcer | A kit exports through its single `.` entry, never a subpath. |
| `browser-kit-dependencies` | architecture-enforcer | A kit depends only on contracts, the design system and `browser-host`. |
