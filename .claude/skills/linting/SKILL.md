---
name: linting
description: "How LangWatch's linters work and how to act on a finding: the oxlint `langwatch` plugin (`pnpm lint`), the whole-tree architecture enforcer (`pnpm lint:architecture`), the file-name grammar, shrink-only baselines, scoped checks while you work. Use when someone says 'what does this lint finding mean', 'langwatch/feature-source-filename', 'module-layers', 'lint:architecture', 'which policy failed', 'is this file name allowed', 'can I suppress this', 'baseline', 'peer-cycles', 'comment block too long', 'the linter says X', or a lint run names a file you just wrote. To add or change a rule use the lint-rule skill instead."
user-invocable: true
---

# Linting: read the finding, do what it says

The linters are first in the truth order (`CLAUDE.md`). They outrank
`dev/docs/ARCHITECTURE.md`, which says so itself (§17). When a finding and a
document disagree, the finding is right and the document is the defect.

## Two tools

| Tool                            | Runs                             | Looks at                                                       | Reference                                        |
| ------------------------------- | -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| oxlint + the `langwatch` plugin | `pnpm lint`, `pnpm lint:changed` | One file at a time: names, imports, layers, comments           | `dev/docs/lint-rules.md` (generated, every rule) |
| architecture enforcer           | `pnpm lint:architecture`         | The whole tree: package graph, ownership, cycles, dead exports | `packages/architecture-enforcer/README.md`       |

The plugin lives in `packages/oxlint-rules` (rules under `src/rules/`, grammar
tables under `grammar/`). `pnpm lint` (`dev/nx/lint.mjs`) runs two oxlint
processes in parallel (§17): `.oxlintrc.native.jsonc`, the stock rules, and
`.oxlintrc.plugin.jsonc`, which extends
`packages/architecture-enforcer/oxlint.architecture.jsonc` and turns every
`langwatch/*` rule on at `error`. Type-aware rules sit in
`.oxlintrc.types.jsonc` (`pnpm lint:types`; CI runs it). `.oxlintrc.jsonc`
extends all three, for one scoped run over your paths. The commands are in
`dev/docs/TOOLING.md`. The enforcer's policies are one registry in
`packages/architecture-enforcer/src/policies/index.ts`; each names the spec its
scenarios live in.

## Rules that matter

1. **A message is `what` plus `fix`.** `fix` is one imperative you can apply
   without opening another file. Do it. The `why` is only in the generated doc.
   An escapable rule's message adds one sentence: how to disable it with a reason.
2. **Never game a rule by renaming.** A file renamed `*.rules.ts` to dodge a
   service check is the defect, not the fix.
3. **No autofixers on `langwatch/*` rules.** Almost none have one on purpose. Do
   not run `oxlint --fix` across the tree to clear them.
4. **A suppression that suppresses nothing is an error**
   (`reportUnusedDisableDirectives`). A disable naming a `langwatch/*` rule is
   itself an error (`langwatch/suppression-states-why`), except on the few
   escapable rules (§17), and there only with `-- <why the framework cannot>`;
   a bare disable is an error. When the case is confusing, ask the human.
   Comment size is unsuppressible (`CLAUDE.md`: five lines including delimiters).
5. **The grammar file is the authority on file names**, not the record (§3.2):
   `packages/oxlint-rules/grammar/feature-layout-policy.mjs`. Layer imports
   are `grammar/module-layers.mjs`.
6. **Baselines only shrink.** No policy reads a baseline. The ruled shrink-only
   lists sit under `packages/architecture-enforcer/tests/baselines/`
   (`eventing-table-access.json`, `framework-module-contracts.json`,
   `deleted-spellings.json` for §15), each held by a test. Growth inside a key is
   refused, and so is a listed finding that has gone (§17). Every peer cycle is
   refused outright; there is no peer-cycle list. Remove an edge in the change that cuts it.
7. **A finding carries its scenario.** Rule docs list `Spec:`
   (`specs/tooling/lint-<rule>.feature`); policies list theirs via
   `--list-policies`. If you disagree with a finding, read the scenario, then
   change the rule through the `lint-rule` skill, not the call site.
8. **Check narrow while working, wide once.** Never `pnpm lint`,
   `pnpm format` or `pnpm typecheck` over the tree from a lane
   (`.claude/skills/core/repository-rules.md`).

## Scoped checks

```bash
pnpm exec oxfmt --write --disable-nested-config <paths>     # never an empty list
pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc <paths>
pnpm lint:changed                                           # your changes + dependents, cached
pnpm lint:architecture --list-policies                      # id and spec of each policy
pnpm lint:architecture --policies feature-layout,manifests  # only these ids
```

`--all` prints every finding instead of the first 25 per policy. A policy whose
anchor file is missing exits 2 by name; that is not a clean tree.

## Worked example: a layer crossing

In `modules/automation/process/src/`, a service imports the Prisma backend:

```ts
// services/automation-rules.service.ts  (wrong)
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository.ts";
```

`langwatch/module-layers` reports `serviceNamesABackend`. Its fix line says to
import the `repositories/<subject>.repository.ts` interface and take the
implementation from the module's repository registry. So the service names
`../repositories/trigger.repository.ts` (an interface) and the registry
(`repositories/automation-repositories.registry.ts`) picks `prisma` or `memory`.
Repository = owned state, channel = unowned messages, service = behaviour over
both (§3.2). The same rule table (`LAYER_MAY_TAKE`, `LAYER_NEVER_NAMES`) refuses
a transport that names `services/` directly.

A file-name finding is the same loop: `triggerRepo.ts` fails
`langwatch/feature-source-filename` (`<subject>.<artifact>.ts`, lower kebab);
`trigger.repository.ts` passes. The artifact suffix table
(`api`, `channel`, `repository`, `rules`, `service`, `subscriber`, ...) is
`ARTIFACT_TABLE` in the grammar file. Read that table; do not guess a suffix.
The installer stem is `<f>.module.ts` (`modules/monitor/process/src/monitor.module.ts`).

## Which finding comes from where

| Finding looks like                             | Source                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| `langwatch/<rule>` with file and line          | the plugin; `dev/docs/lint-rules.md`                 |
| `<policy-id>` with a package or edge, no line  | an enforcer policy                                   |
| a name you cannot find in the generated doc    | the policy id; grep `src/policies/index.ts`          |
| `import/no-cycle`, `typescript/*`, `unicorn/*` | stock oxlint, configured in `.oxlintrc.native.jsonc` |

## Traps

- **Piping oxlint output through `head` or `grep`** hides the exit status. Read
  the finding count it prints.
- **Treating a green scoped run as a clean tree.** Whole-tree policies see
  graph facts a path-scoped run cannot; run `--policies` for the ones you may
  have touched before you hand off.
- **Editing a generated file to clear a finding.** Fix the generator or its
  input (`modules/catalogue.json`, then `pnpm generate:modules`).
- **Adding to a baseline to ship.** The list is shrink-only. A new edge is a
  design question, not a bookkeeping line.
- **Running `oxfmt --write` on a computed list you have not looked at.** An empty
  expansion formats the whole repository.
- **Reading old advice about `dev/lint/oxlint.baseline.jsonc`.** It is gone;
  the config has no baseline or per-file exemption.

## Links

- `dev/docs/ARCHITECTURE.md` §17 (enforcement, baselines), §15 (spellings the
  linter refuses), §16 (names in flight).
- `.claude/rules/lint-tooling.md`, `dev/lint/README.md` (which kind of rule
  belongs where), `dev/docs/adr/137-module-source-grammar.md`.
- Adding or changing a rule: the `lint-rule` skill.
