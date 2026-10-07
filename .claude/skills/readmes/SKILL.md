---
name: readmes
description: "Maintaining the generated READMEs and their generator (tools/readmegen): the hand-written head and generated body of a page, pnpm generate:readmes and pnpm check:readmes, what a ≈ value means, the REST cross-check, adding a section or an extractor shape, and the golden tests. Use when someone says 'the README is stale', 'check:readmes failed', 'generate:readmes', 'describe this page', 'the README is wrong', 'readmegen', '≈ on the page', 'unresolved value', 'mounted but not read', 'add a section to the README', or 'teach the extractor'."
user-invocable: true
---

# READMEs: the generated pages

Plan and rulings: `dev/docs/plans/module-readmes-2026-10-06.md` (sections 3, 5 and 9). The
generator is `tools/readmegen`: Go reads `modules/catalogue.json`, each `package.json` and the
Prisma schema; an embedded TypeScript extractor (`tools/readmegen/extract/`) reads declarations
and hands Go a manifest. For which page answers which question, load `ownership`.

## Commands

| Command                                               | What it does                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm generate:readmes`                               | rewrites every stale generated block                                                         |
| `pnpm check:readmes`                                  | exit 1 with a diff for each stale page, and for each page with no hand-written paragraph     |
| `go run ./cmd/readmegen --write --only modules/slack` | settles only pages whose path starts with the prefix                                         |
| `go test ./tools/readmegen/`                          | the golden tests; add `-update` to rewrite `tools/readmegen/testdata/golden/` after a change |

The extractor runs under `node` from `packages/architecture-enforcer`, so it needs an installed
workspace (`pnpm install`). It also mounts the api describe-only for the REST cross-check; when that
mount fails the check is skipped with "REST cross-check skipped", and the pages still settle.

## A page

A page is a hand-written head and a generated body. The generator keeps everything outside the
markers and rewrites only what is between them.

| Part                                                | Who writes it | Rule                                                                                                |
| --------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `# <name>` and a paragraph saying what it is for    | a person      | required: a page with no paragraph fails "describe <name> in a paragraph above the generated block" |
| `<!-- readme:generated:start ... -->` to `:end -->` | the generator | never edited by hand; fix the code, then regenerate                                                 |

Pages today: the indexes (`modules/`, `enterprise/modules/`, `enterprise/`, `packages/`,
`enterprise/packages/`, `apps/`), one page per module and one per process half. Contract and client
halves get no page; the contract is printed on the process page (ruling Q2).

## Fixing a wrong page

| You see                                 | It means                                              | Do                                                                             |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| a stale diff in `check:readmes`         | the code changed and the page did not                 | run `pnpm generate:readmes`; commit the page with the code                     |
| `≈` before a value                      | the extractor found the declaration but not its value | make the value static in the code, or teach the extractor the shape (below)    |
| "unresolved values (shown with ≈): ..." | the run's count of `≈` values, by kind                | informational; it does not fail the check                                      |
| `REST "<family>": mounted but not read` | a route the api serves that the syntactic read missed | teach the extractor the router shape; this one does fail the check             |
| a fact that is wrong, not `≈`           | a bug in an extractor or a page renderer              | fix it in `tools/readmegen`, with a fixture row and a golden page that show it |

## Adding a section or an extractor shape

1. Add the field to the manifest types on both sides: `tools/readmegen/manifest.go` or
   `process_manifest.go`, and the extractor module that fills it (`extract/module-facts.mts`,
   `extract/process-facts.mts`).
2. Read it syntactically. A value the extractor cannot fold is a `Scalar` with its source text,
   printed with `≈`; never guess.
3. Render it in the page file that owns the section (`module_page.go`, `process_page.go`,
   `workers_page.go`, `pages.go` for the indexes). Pages are tables; link to `file:line` rather than
   inlining a long schema.
4. Add the case to `tools/readmegen/testdata/manifest.json`, run `go test ./tools/readmegen/ -update`,
   and read the golden diff as the review.
5. Run `pnpm generate:readmes` and commit the regenerated pages with the generator change.

## Traps

| Trap                                                                      | Do instead                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Editing a fact inside the markers so the page reads right                 | the next run puts it back; fix the code or the generator                                        |
| Leaving a stale part of an old hand-written README above the block        | replace it with one paragraph; anything worth keeping moves to the module's `adrs/` (ruling Q4) |
| Regenerating with `--update` on the golden tests without reading the diff | the golden diff is the proof the change did what it says                                        |
| Running `check:readmes` with no install                                   | the extractor fails to start; run `pnpm install` first                                          |
