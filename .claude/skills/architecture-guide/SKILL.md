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

| You are asking | Read | Then skill |
| --- | --- | --- |
| What runs where; what an app is | §1 | `repo-tree` |
| Which package; where code lives; Chakra, colour | §2 | `repo-tree`, `design-system` |
| Module anatomy; dependency direction | §3 | `module` |
| `*Api` token, schemas, errors, verbs | §3.1, §12 | `contract` |
| Services, repositories, channels, rules, file grammar | §3.2 | `process-module` |
| What a module may demand; peers, supply, capabilities | §3.3, §3.5, §6, §11 | `module-dependencies` (future) |
| Browser half; no kits; closed packages | §3.4, §10 | `browser-module` |
| Reading another module's data in the browser | §3.4, §10.1 | `module-client` |
| `main.ts`, `boot()`, config, stores | §4, §5, §6, §7 | `process-composition` (future) |
| REST routes, tRPC procedures, `/api/<x>` | §8 | `api-transports` |
| Projections, subscribers, process managers, purge | §9, §9.1 | `eventing-and-worker` |
| Browser state tiers, one global store | §10.2, ADR-169 | `browser-module` |
| Enterprise, entitlement, licences | §11 | `module-dependencies` (future) |
| Throwing, error codes, REST error bodies | §12 | `contract` |
| Tests, memory tier, spec binding | §13, §14 | `testing` |
| Is this spelling dead? | §15 | none: do not write it |
| Does the target name exist yet? | §16 | none |
| What a finding means; baselines | §17 | `linting` |
| Nx, `test:affected`, caches | §18 | `.claude/skills/core/testing-rules.md` |

A skill marked planned or future may not exist yet (check the skill list). Until it does, `backend`
and `frontend` still cover that ground (partly stale; the record wins).
Dependency injection (members, `Secret.load`, supply tokens, capabilities,
entitlements) is deliberately not taught in wave-1 skills: it is under review.
Read §3.3 and ADR-147/148 directly and ask before inventing a shape.

## Rules for using the record

1. **Read the section before you write the shape.** Cite the section or an
   in-tree precedent (file and line) for every new module, pipeline, operation,
   type or repository.
2. **§15 is a list of deleted spellings.** Writing one new is a defect; reading
   one in old code is conversion debt. Do not copy a spelling you find in the
   tree without checking §15 first.
3. **§16 maps target names to today's names.** The tree still carries the right
   column for several (`defineServerModule`, `<f>.server.ts`, `*App` classes,
   `@langwatch/kernel`). Skills teach what is in the tree and link §16 for the
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
  shrinks. `modules/monitor` and `modules/organization` also keep `app/<f>.app.ts`.
- **Citing a deleted ADR or skill reference.** Composition ADRs before 147/148
  are historical (§17).
- **Skipping the specs.** If no scenario covers the task, write one first,
  error paths included (`CLAUDE.md`).

## Known disagreements between the record and the tree

Prefer the tree for names and the linter for rules; report, do not fix a record
you do not own. Current list:

- §2/§4 name `@langwatch/installed-modules`; the tree has
  `installed-server-modules` and `installed-web-modules`.
- §4 says an app has no config file; `apps/{api,worker,tasks}/src/config.ts` exist.
- §3 says each module has a root `feature.json`; none does.
- §12 cites `packages/handled-error/src/app-codes.ts`, which is gone.

## Links

`dev/docs/ARCHITECTURE.md` (all), `dev/docs/adr/147-compiler-checked-process-supply.md`,
`dev/docs/adr/148-declared-browser-supply.md`, `dev/docs/CODING_STANDARDS.md`,
`.claude/skills/core/repository-rules.md`.
