# Manifest: merge-docs-pilot

Objective: Every conflicted path under `docs/` is resolved, with main's restructure honoured and this branch's edits either carried into main's new pages or dropped with a stated reason.
Owner: merge-docs-pilot
Model: sonnet   <173 prose conflicts with one clear resolution rule; the judgment is per-page editorial, not architectural, and the pilot exists to prove the mechanism at the lowest stake>
Budget: 130 tool calls or 90 minutes, whichever comes first
Handoff: .claude/handoffs/merge-docs-pilot.md

## Context - read this before you touch a marker

The coordinator has started `git merge origin/main` and **left it conflicted on
purpose**. The tree you are in is a live, in-progress merge. Your job is to edit
files until the markers are gone and the prose is right.

This is the pilot for the whole merge. Eight more areas follow. If the mechanism
is wrong, this is where it should be found, which is why `docs/` goes first:
nothing here can break a boot.

**You make no git writes.** No `git add`, no `git commit`, no `git merge
--continue`, no `git checkout --ours/--theirs`, no `git restore`. The coordinator
stages and commits. `git status`, `git diff`, `git log`, `git show` are fine and
you will want them. If you find yourself wanting `--theirs`, delete the file's
conflicting half by editing instead, or say in the handoff that the file should
be deleted - see below.

## What main did to docs/

Measured at merge base `105613d379`, against `origin/main`:

```
61 files deleted     174 files added     docs/docs.json rewritten
```

It is a **restructure**, not a set of edits. `docs/ai-gateway` alone lost 13
pages and gained 11, reorganised into `api/`, `providers/` and `cookbooks/`.

## Your conflicts

```
150  content         both sides changed the same lines
 23  modify/delete   main DELETED the page, this branch MODIFIED it
```

Lists: `dev/docs/plans/main-merge-2026-09-11/content.txt` (filter to `^docs/`)
and `modify-delete.txt` (filter to `docs/`).

## The resolution rule, and it is not symmetric

The plan's rule is that **main's change either lands somewhere, or it is dropped
with a stated reason**. "Took ours" is a decision, not a resolution, and it gets
a line in your handoff.

For the 23 **modify/delete** the rule points the other way, so read it carefully:

> Main deleted the page. The question is **where its content now lives on main**,
> and this branch's edit has to follow it there.

Corrected 2026-09-11 after this went wrong once. The first version of this section
said "main's deletion wins by default", a lane deleted all 23, and that dropped
roughly 400 lines of this branch's documentation. Main **moved** these pages; it
did not drop the topics. So:

**Where main has a replacement page, carry our edit into it.** Verified mapping:

| Deleted here | Main's page |
| --- | --- |
| `ai-governance/audit-log.mdx` | `docs/platform/audit-log.mdx` |
| `ai-governance/data-privacy.mdx` | `docs/platform/data-privacy.mdx` |
| `ai-governance/roles-and-permissions.mdx` | `docs/platform/rbac.mdx` |
| `ai-governance/members-and-invites.mdx` | `docs/platform/members-and-teams.mdx` |
| `ai-governance/departments.mdx` | `docs/ai-governance/workspaces.mdx` / `people.mdx` |
| `features/annotations.mdx` | `docs/annotations/overview.mdx` |
| `ai-gateway/caching-passthrough.mdx` | `docs/ai-gateway/cache-control.mdx` |
| `ai-gateway/cookbooks/multi-tenant-reseller.mdx` | `cookbooks/metering-and-rebilling.mdx` |
| `ai-gateway/cookbooks/production-runbook.mdx` | `cookbooks/prometheus-alerts.mdx` + `grafana-dashboard.mdx` |
| `ai-gateway/provider-bindings.mdx` | `ai-gateway/concepts.mdx` |
| `ai-gateway/governance/activity-monitor-event-sourcing.mdx` | `ai-gateway/governance/architecture.mdx` / `audit.mdx` |

**Where main has none, keep our page.** That is `ai-gateway/cli/*` (6),
`optimization-studio/*` (4), `better-agents/overview.mdx` and
`evaluations/online-evaluation/by-thread.mdx` - twelve pages whose areas main
removed outright.

The reasoning, because it is the opposite of what this section said first: an
orphan page is a navigation bug and costs one entry in `docs.json` to fix. A
deleted page loses documented behaviour for a feature this branch still ships -
optimization studio is what `services/nlpgo` executes, the gateway CLI
integrations exist. The cheap mistake and the expensive one are not symmetric, so
the default goes to keeping.

If you think main deleted a page because the feature itself went away, leave the
page and say so in the handoff. That is the coordinator's decision, not a
resolution.

Recovering a page: `git show :2:<path>` is our version with our edits. Write it
back with your editor - no git writes.

For the 150 **content** conflicts, ordinary judgment: both sides edited the same
lines, and usually both changes are wanted. Merge the meaning, not the diff.

## Owned paths

    docs/**

Every conflicted file under `docs/`, and nothing else in the repository.

## Shared paths - stop and request

    docs/docs.json          coordinator - the navigation, and global state like a migration
    dev/docs/**             coordinator - not part of this merge area
    everything outside docs/  other lanes or the coordinator

`docs/docs.json` is **not yours** even though it is under `docs/`. It is the
Mintlify navigation: it decides which pages exist as far as a reader is
concerned, main rewrote it, and a page resolved in isolation cannot see whether
the navigation still points at it. Write what you need into handoff section 10.

## Read-only reference paths

    dev/docs/plans/main-merge-2026-09-11/README.md            the merge plan and its rule
    dev/docs/plans/main-merge-2026-09-11/content.txt          your 150
    dev/docs/plans/main-merge-2026-09-11/modify-delete.txt    your 23
    CLAUDE.md                                                 the docs frontmatter rule, below

## Invariants

- **Frontmatter.** `title` renders as the H1 and `description` as the lede beneath
  it. Never open a page with a heading or sentence repeating either. If a
  resolution leaves a page doing that, fix it while you are there.
- No conflict marker survives. Not in a code fence, not in an `.mdx` comment,
  not in a file you decided not to change. Grep for them at the end.
- A page main deleted stays deleted.
- Do not edit `docs/docs.json`.
- Do not add a page. This is a merge, not authoring: if main's restructure left a
  gap, record it rather than filling it.
- Do not "fix" prose that is not conflicted. A merge diff that also rewrites
  forty unconflicted paragraphs cannot be reviewed.
- British spellings stay as the surrounding page has them; do not normalise.

## Checks

There is no test suite for prose. Your checks are these three, and you run all of
them at the end:

    LC_ALL=C grep -rlF '<<<<<<<' docs/ | head
      -> must print nothing

    git diff --stat docs/ | tail -1
      -> sanity: is the size of this change plausible for what you resolved?

**Do not expect `git status` to stop saying `UU`.** Only `git add` clears an
unmerged path and you make no git writes, so every file you finish still reads as
unmerged until the coordinator stages it. That is correct and is not a sign you
missed something. Your evidence is the markers being gone and the prose being
right; the index is the coordinator's half.

**A file with no marker may still be unresolved.** `rerere` is enabled in this
checkout with 2,755 cached resolutions and it has already replayed a previous
merge attempt's answer into 199 of the content conflicts, which is why some
conflicted files look finished. Under `docs/`, 84 of your 150 content conflicts
arrived that way. Spot-check a handful against `git diff --ours <file>` and
`git diff --theirs <file>`: if the replayed answer is a sensible blend, leave it
and say so; if it silently dropped main's change, fix it and name it in the
handoff. Do not re-resolve all 84 by hand - that is the work rerere just saved.

Never run a whole-tree check. Never `pnpm typecheck`, `pnpm lint` or `pnpm test` -
you changed no code.

## Stop conditions

- `docs/docs.json` needs to change for a resolution to make sense
- a conflict is not prose - a code sample whose correctness you cannot judge
- main's replacement page for a deleted one cannot be found, for more than three
  pages (one or two, record and move on)
- the budget is reached - **stop cleanly, this is 173 files and partial is fine.**
  Resolve whole files, never leave one half-resolved, and say in the handoff
  exactly which paths are done and which are untouched.

## Completion criteria

- no conflict marker anywhere under `docs/`
- no unmerged path under `docs/` in `git status`
- every one of the 23 modify/delete conflicts is recorded in the handoff as
  either "edit carried to <page>" or "edit dropped because <reason>"
- no page main deleted exists in the tree
- the handoff names any page whose navigation entry the coordinator must check
