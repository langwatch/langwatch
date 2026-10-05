---
name: architecture-guide
description: "Route a question to the right section of the one architecture record, dev/docs/ARCHITECTURE.md, and to the skill that teaches it. Use before composing a process, writing a module, a contract operation, a repository or any new shape; and when someone says 'what does the architecture say about', 'where in the record', 'is this allowed', 'what is the rule for', 'deleted spelling', 'renamed in flight', 'the record and the code disagree', 'who decides', or cites a section number. Read this first when you do not know which skill applies."
user-invocable: true
---

# The architecture guide

**One record: `dev/docs/ARCHITECTURE.md`.** Every other architecture document
is deleted or points there. This skill does not restate it. It tells you which
section answers your question, what outranks the record, and what to do when
the record and the tree disagree.

## Truth order

1. **The linters** (`pnpm lint`, `pnpm lint:architecture`). Highest. The `linting`
   skill reads a finding.
2. **`dev/docs/ARCHITECTURE.md`.** On conflict between sections, the more
   specific wins.
3. **`specs/` and `modules/<name>/specs/`.** Feature files are requirements.

When a lower one disagrees with a higher one, the lower one is the defect
(record intro and §17).

## Question to section

| You are asking                                        | Read                | Then skill                                   | Backed by (`langwatch/*` rule; enforcer policy)                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What runs where; what an app is                       | §1                  | `repo-tree`                                  | policy `application-boundaries`                                                                                                                                                                                                                                                                      |
| Which package; where code lives; Chakra, colour       | §2                  | `repo-tree`, `design-system`                 | `package-boundaries`, `environment-boundaries`; policies `workspace-seams`, `manifests`, `cycles`                                                                                                                                                                                                    |
| Module anatomy; dependency direction                  | §3                  | `module`                                     | `module-layers`, `module-classes`, `feature-source-filename`, `feature-source-layout`, `feature-source-subject`; policies `feature-layout`, `feature-shape`, `source-folder-shape`                                                                                                                   |
| `*Api` token, schemas, errors, verbs                  | §3.1, §12           | `contract`                                   | `schema-outside-contract`, `handled-error-outside-contract`, `refusal-is-a-handled-error`, `banned-verb-prefix`, `fallible-result-naming`                                                                                                                                                            |
| Services, repositories, channels, rules, file grammar | §3.2                | `process-module`                             | `service-does-not-open-a-channel`, `service-loads-its-own-config`, `store-containment`, `pass-through-class`; policies `prisma-table-ownership`, `clickhouse-table-ownership`, `memory-twin-drift`, `service-ceilings`                                                                               |
| What a module may demand; peers, supply, capabilities | §3.3, §3.5, §6, §11 | `module-dependencies`                        | `package-boundaries`, `store-containment`, `module-classes`, `environment-boundaries`, `service-loads-its-own-config`, `no-hand-rolled-plan-gate`, `plan-literals`, `enterprise-license-header`; policies `peer-cycles`, `cycles`, `feature-configuration`; boot `config_collision`, `secret_sealed` |
| Browser half; no kits; closed packages                | §3.4, §10           | `browser-module`                             | `web-imports-server-shaped-value`, `environment-boundaries`; policies `browser-package-closure`, `browser-package-exports`, `browser-node-leak`                                                                                                                                                      |
| Reading another module's data in the browser          | §3.4, §10.1         | `module-client`                              | policies `browser-package-exports`, `framework-module-contracts`                                                                                                                                                                                                                                     |
| `main.ts`, `boot()`, config, stores                   | §4, §5, §6, §7      | `process-composition` (future)               | `no-boot-hook-outside-guard`; policies `peer-cycles`, `cycles`, `declarations`, `prisma-migration-access`, `eventing-table-access`                                                                                                                                                                   |
| REST routes, tRPC procedures, `/api/<x>`              | §8                  | `api-transports`                             | `transport-declares`, `rest-route`; policy `platform-operator-calls`                                                                                                                                                                                                                                 |
| Projections, subscribers, process managers, purge     | §9, §9.1            | `eventing-and-worker`                        | `eventing-role-purity`, `idempotency-key-is-stable`; policies `eventing-table-access`, `service-projection-boundaries`                                                                                                                                                                               |
| Browser state tiers, one global store                 | §10.2, ADR-169      | `browser-module`                             | `browser-store-containment`, `query-data-in-state`, `no-redux`                                                                                                                                                                                                                                       |
| Enterprise, entitlement, licences                     | §11                 | `module-dependencies`                        | `no-hand-rolled-plan-gate`, `enterprise-license-header`, `package-boundaries` (`coreImportsEnterprise`)                                                                                                                                                                                              |
| Throwing, error codes, REST error bodies              | §12                 | `contract`                                   | `handled-error-outside-contract`, `refusal-is-a-handled-error`                                                                                                                                                                                                                                       |
| Tests, memory tier, spec binding                      | §13, §14            | `testing`                                    | `test-description-is-an-action`, `unit-test-does-not-render`, `stand-in-cast`, `no-logger-spy`, `no-tautological-assertion`; policy `default-test-lane`; `check:feature-parity`                                                                                                                      |
| Is this spelling dead?                                | §15                 | none: do not write it                        | none (some spellings are caught by the rules above)                                                                                                                                                                                                                                                  |
| Does the target name exist yet?                       | §16                 | none                                         | none                                                                                                                                                                                                                                                                                                 |
| What a finding means; baselines; disables             | §17                 | `linting`                                    | `suppression-states-why`, `comment-block-size`, `id-generation-origin`; every policy (`pnpm lint:architecture --list-policies`)                                                                                                                                                                      |
| Nx, `test:affected`, caches; how the drive runs       | §18                 | `.claude/skills/core/testing-rules.md`       | none                                                                                                                                                                                                                                                                                                 |
| The local stack, haven, the sims, `apps/server`       | §19                 | `haven`, `sims`, `dev-runtime`, `server-cli` | none                                                                                                                                                                                                                                                                                                 |

A skill marked planned or future may not exist yet (check the skill list). Until it does, `backend`
and `frontend` still cover that ground (partly stale; the record wins).
Members and supply tokens are deleted (§3.3, §15): a module class receives
repositories, channels, peers, config and secrets, and decides its own availability.
For `Secret.load`, capabilities and entitlements, the `module-dependencies` skill.

## Rules for using the record

1. **Read the section before you write the shape.** Cite the section or an
   in-tree precedent (file and line) for every new module, pipeline, operation,
   type or repository.
2. **§15 is a list of deleted spellings.** Writing one new is a defect; reading
   one in old code is conversion debt. Do not copy a spelling you find in the
   tree without checking §15 first.
3. **§16 maps target names to today's names.** The tree still carries the right
   column for the rows still open. The rename window (2026-10-01) landed the
   package, `define*Module`, `.module.ts` and `*Module` rows; their old
   spellings are in §15. Skills teach what is in the tree and link §16 for the
   target. Do not rename on your own.
4. **A rule without an owner is not a ruling.** A "ruling" cites the record or
   Alex's words with a date. If a manifest or a skill says "must" and cites
   neither, flag it.
5. **A new design choice is not yours.** A new `*Api` operation, a type
   restating a contract, a shim around a store member or a chosen constant is a
   design choice. Propose it with options; do not write it.
6. **No new patterns.** Use what exists. Throw a `HandledError`; do not invent
   an error envelope or handler.
7. **Fix the record in the same change as the code** when it teaches something
   the tree refuses (§17). Rulings land in `ARCHITECTURE.md` with the date.

## Worked example: "where does the invite throttle go?"

1. Subject: `invite`. The catalogue gives it to `organization`
   (`modules/catalogue.json`), so §2/§3: it is in `modules/organization`.
2. It is behaviour over owned state: §3.2, a service. See
   `modules/organization/process/src/services/invite-creation-throttle.service.ts`.
3. If another module needs the answer: §3.1, an op on `OrganizationApi` in
   `modules/organization/contract/src/organization.api.ts`. Never import the
   service. Adding that op is a design choice: propose it, do not write it.
4. Name the op: ADR-146 (`dev/docs/adr/146-method-verb-vocabulary.md`);
   `get*` throws, `find*` returns an array (§15).
5. Unsure it exists already: `modules/monitor` (smallest) and
   `modules/automation` (fullest) are the in-tree exemplars.

## Traps

- **Believing a section number is stable.** Search by heading; the record is
  edited often.
- **Treating §16's left column as the tree.** It is the target; check the tree.
- **Copying `app/<f>-composition.build.ts` into a new module.** The grammar
  calls it the ported composition a converted module still carries; it only
  shrinks, and §15 lists it as deleted (§5).
- **Citing a deleted ADR or skill reference.** Composition ADRs before 147/148
  are historical (§17).
- **Skipping the specs.** If no scenario covers the task, write one first,
  error paths included (`CLAUDE.md`).

## Known disagreements between the record and the tree

Prefer the tree for names and the linter for rules; report, do not fix a record
you do not own. Current list:

- §3.2/§5 put the module class in `<f>.module.ts`; no `<f>.module.ts` holds it yet and all 62 classes sit in
  `app/<f>.app.ts`, which the grammar accepts; §16 has no row yet (awaiting a ruling; counted 2026-10-05).
- `useReleaseFlag` (§3.4, §10.1) is the target; code spells `useFeatureFlag` (54 files), no §16 row.
- `requestDelivery` (ADR-167, §9) has no code hits and no §16 row naming today's spelling.
- §8/§17's guard rules that accept a justified disable are not built yet: `defineRule({ escape })` exists,
  but no rule opts in, so today every `langwatch/*` disable is refused (2026-10-05).
- §5 expects no peer cycle; the `peer-cycles` policy stays red until the last is cut (ruled, not drift).
- Open items are proposals, not rules: §16 "Open for Alex" (usage-named files, E1 to E9 questions, L6b R3,
  E10). Do not build or teach them as ruled.

## Links

`dev/docs/ARCHITECTURE.md` (all), `dev/docs/adr/147-compiler-checked-process-supply.md`,
`dev/docs/adr/148-declared-browser-supply.md`, `dev/docs/CODING_STANDARDS.md`,
`.claude/skills/core/repository-rules.md`.
