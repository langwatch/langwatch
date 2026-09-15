# The 312 `DU` conflicts in the deleted monolith

`DU` is "deleted by us, modified by them": this branch removed `platform/app`,
main kept working in it. 312 paths, **28,529 lines** of main's changes. They are
the largest single block left in the merge and the only one with no owner.

Measured 2026-09-11 at the live merge. Raw data in `platform-du-inventory.tsv`
(`lines-changed <TAB> was-added-by-main <TAB> path`), regenerate with the loop at
the bottom of this file.

## Two facts that shape everything else

**Not one of the 312 is a file main created after the fork.** Every one is an edit
to a file that already existed at the merge base. So there is no hidden new module
in here - only changes to code this branch has rewritten somewhere else. That is
what makes the per-file question answerable: *is main's edit superseded by the
rewrite, or is it a capability the new module does not have?*

**The churn is not spread evenly.** Two thirds of it is four coherent bodies of
work, and the long tail is genuinely small:

| Destination | files | lines | Status |
| --- | ---: | ---: | --- |
| **Governance port** (`ee/governance`, `ingestion-pull-processing`, `pages/governance`) | 58 | 10,890 | **already scoped** - its own lane, decided in `directory-rename-split-decisions.md` |
| `src/app/api/openapiLangWatch.json` | 1 | 4,430 | **generated** - regenerate, never merge |
| `modules/analytics` | 40 | 1,840 | lane live |
| `modules/suite` | 18 | 1,635 | needs an owner |
| `modules/scenario` | 28 | 1,403 | lane live |
| `packages/eventing` + owning module | 18 | 1,104 | needs an owner |
| `apps/ui` | 18 | 852 | needs an owner |
| `platform/app/package.json` | 1 | 699 | dependency manifest - coordinator |
| `apps/api` routers | 12 | 690 | needs an owner |
| `modules/dataset` | 4 | 548 | needs an owner |
| `modules/agent` | 15 | 527 | needs an owner |
| `modules/annotation` | 6 | 468 | needs an owner |
| `modules/trace` | 2 | 295 | needs an owner |
| long tail | 91 | 3,148 | routable, see below |

**38% of the churn is the governance port**, which is already a decided piece of
work. It should come out of the merge entirely, exactly as its 58 `UA` siblings
did. Another 4,430 lines is one generated file. So the merge's share of this block
is far smaller than 312 paths suggests.

## The long tail routes too

The 91 that no simple rule caught are small - the largest is 298 lines, most are
under 100 - and each has an obvious owner once you read the path:

```
src/tasks/provisionLwql.ts                 -> apps/tasks
src/server/routes/{health-checks,langy-api} -> apps/api
src/server/workers/startWorkers.ts          -> apps/worker
src/server/app-layer/langy/**               -> modules/langy
src/server/app-layer/projects/**            -> modules/project
src/server/app-layer/clients/clickhouse/**  -> packages/clickhouse-client
src/server/data-retention/**                -> modules/data-retention
src/hooks/**, src/features/navigation/**    -> apps/ui
platform/app/scripts/**                     -> dev/scripts
```

Nothing in the 312 is genuinely homeless. The open question is never *where does
this belong* - it is *does main's edit still say something the new code does not*.

## How to work it

The mapping above was produced by a shell loop over `git diff --numstat`, not by a
model, and it took two minutes. Do not spend an agent on re-deriving it.

What needs a model is the per-file judgment, and it is the same judgment every
time:

> Read main's diff for this file (`git diff <base>..origin/main -- <path>`), then
> read the code that replaced it on this branch. Is main's change already there
> under another name, or is it a capability the new module lacks?

Two failure modes, both already paid for once in this merge:

- **Do not answer "already there" from a filename or symbol grep.** The rewrite
  renamed almost everything. Search for what the code *does*.
- **Do not answer "superseded" just because the file is deleted.** That is the
  `DU` category restating itself, not a finding.

Suggested shape, given the block decomposes:

1. Take the governance 58 out - they belong to the governance port lane.
2. Regenerate the OpenAPI document; resolve `package.json` at the coordinator.
3. Fold each module's slice into that module's merge lane where one exists
   (`modules/analytics`, `modules/scenario` are live now). A lane already reading
   that module's conflicts is the cheapest place to ask "and is this edit covered?"
4. What is left - suite, eventing, agent, dataset, annotation, trace, the ui and
   api slices, the long tail - is roughly 150 files and 9,000 lines. One **Sonnet**
   classification pass producing a verdict per file, then one **Opus** lane for the
   handful that turn out to be real capability gaps. Classification is cheap and
   repetitive; implementing a missed capability is not.

Expect the verdict distribution to be heavily "superseded". The value of the pass
is the few that are not - the same shape as the two scenario features `rerere` was
silently dropping.

## Regenerating this inventory

```bash
MB=$(git merge-base HEAD origin/main)
git status --porcelain | awk '$1=="DU"{print $2}' | while IFS= read -r f; do
  ch=$(git diff --numstat "$MB"..origin/main -- "$f" | awk '{print $1+$2}')
  new=$(git log --oneline --diff-filter=A "$MB"..origin/main -- "$f" | head -1 | wc -l | tr -d ' ')
  printf "%s\t%s\t%s\n" "${ch:-0}" "$new" "$f"
done > platform-du-inventory.tsv
```
