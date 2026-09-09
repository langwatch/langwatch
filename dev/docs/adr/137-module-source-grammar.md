# ADR-137: A module's source layout is a grammar, not a convention

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[Filenames](../../../specs/tooling/lint-feature-source-filename.feature),
[layout](../../../specs/tooling/lint-feature-source-layout.feature),
[subjects](../../../specs/tooling/lint-feature-source-subject.feature),
[module classes](../../../specs/tooling/lint-feature-module-classes.feature),
[service classes](../../../specs/tooling/lint-service-classes.feature),
[service quality](../../../specs/tooling/lint-service-quality.feature),
[layer classes](../../../specs/tooling/lint-layer-class.feature),
[namespace classes](../../../specs/tooling/lint-namespace-class.feature),
[the ast-grep delegation rule](../../../specs/tooling/lint-naming-shapes.feature),
[strict feature layout](../../../packages/architecture-lint/specs/strict-feature-layout.feature),
[source folder shape](../../../packages/architecture-lint/specs/source-folder-shape.feature)

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
| `langwatch/feature-module-classes` | plugin | A port module exports an abstract `*Port`; a runtime module exports a concrete class with a `static create`; neither keeps behaviour in a standalone export. |
| `langwatch/service-classes` | plugin | A service module defines exactly one `*Service` class, constructed through `static create`, with no exported standalone function. |
| `langwatch/service-quality` | plugin | No duplicate class member or object key; a class with `static create` has a private constructor. Enabled nowhere today. |
| `langwatch/layer-class` | plugin | A class whose public methods almost all forward under the same name to the same collaborator is a hop, not a layer. |
| `langwatch/namespace-class` | plugin | A class with only static members is a module wearing a class. |
| `no-same-name-delegation` | ast-grep | The same shape as `layer-class`, as a review comment. Duplicate; see ADR-135. |
| `feature-layout` | architecture-lint | A server file outside the folder-and-kind grammar, or a root exporting a private repository, store or projection. |
| `feature-app-contract` | architecture-lint | A module's contract is exactly one `*.api.ts` interface of callable operations named `<Feature>Api`. |
| `feature-setup-infrastructure` | architecture-lint | An App factory's `FeatureSetup` declares concrete technical records, never a peer API or service capability. |
| `feature-shape` | architecture-lint | A module carrying a legacy pre-ADR-133 shape fragment, against a shrink-only baseline. |
| `source-folder-shape` | architecture-lint | Folder and fragment budgets: at most 12 files in a source folder, no sub-20-line fragment only one neighbour reads. |
| `legacy-feature-fragments` | architecture-lint | The remaining legacy composition, adapter, page-shell and transport fragments may only shrink. |

The per-file half is the plugin, because it needs the file's classified role
and layout version. The per-module half is architecture-lint, because it needs
the catalogue, the manifests and the whole tree of a module at once. Neither
half can be expressed in oxlint configuration at all.

## Consequences

The grammar is what makes the module skills work: `module`, `module-review` and
`feature-convert` can state where a file goes because a rule refuses every other
answer, and `dev/docs/lint-rules.md` renders the sentence the rule prints.

Three of these policies are ratchets rather than rules - `feature-shape`,
`source-folder-shape` and `legacy-feature-fragments` each carry a baseline of
existing violations. That is deliberate: the grammar arrived after the code,
and a rule that fails 431 folders on day one is a rule somebody turns off. The
ratchet holds the line and the count only goes down.

`service-quality` is registered and enabled nowhere, and its duplicate-member
half duplicates the available built-in `no-dupe-class-members`. ADR-135 records
both facts as follow-ups.
