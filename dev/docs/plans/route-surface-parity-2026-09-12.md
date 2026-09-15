# The route surface `origin/main` serves, against what this branch declares

Written 2026-09-12 by the visualdiff drive, at the request of the apidiff
drive. Branch `feat/strict-feature-layout-v0`, candidate `bfbb3783ab`.

This is the UI-side companion to
`unserved-documented-operations-2026-09-12.md`. That file lists 70 documented
operations this branch serves with nothing. This one asks the same question of
the browser's URL surface: **which addresses does `origin/main` answer that
this branch answers with nothing at all?**

It matters because it is the one class of parity gap that **neither apidiff nor
visualdiff can see**. apidiff probes documented API operations, so a dropped
*page* is invisible to it. visualdiff renders the routes listed in
`tools/visualdiff/visualdiff.yaml`, so a dropped page nobody thought to list is
invisible to it too — it can only diff screens it is told to render. A route
that fell out of the route table and out of the visualdiff list at the same
time is, until now, unmeasured by anything.

## Method

Static, no stack, reproducible in about a second. Both scripts are throwaway;
the method is the part worth keeping.

- **main's surface**: `git ls-tree -r origin/main --name-only platform/app/src/pages`,
  which is the Next.js pages router, so file path *is* route. Dropped:
  `__tests__`, `/api/`, `_app`/`_document`/`_error`, and colocated component
  files (a basename carrying an uppercase letter, or `*.unit.test`) — Next.js
  would route those too, but no person ever reached them. 150 real pages.
- **the branch's surface**: `apps/ui/src/model/ui-route-table.ts`, walked
  recursively so nested `children` join onto their parent path, collecting
  **both** `page` entries (135) and `redirect` entries (24, of which 12 come
  from `uiLegacyRedirectRoutes` and the rest are declared inline in the table).
- **plus what is contributed at install time**: the route table is not the
  whole answer. `apps/ui/src/features/annotation/index.ts` calls
  `ui.routes("project", annotationRoutes)`, adding five `/:project/annotations*`
  routes that appear nowhere in the table. It is currently the *only*
  `.routes(` call in the tree — worth re-checking before trusting this method
  again, because a second contributor would silently widen the branch's real
  surface past what the table shows.
- Both sides normalised: `[project]`/`:project` and every other dynamic segment
  to one token, `[...path]`/`[[...path]]` to `*`, `index` stripped.

Two false-positive classes this method hits if you skip the steps above, both
of which cost me a detour: the annotation routes (contributed, not tabled) and
the inline redirects (`/me/devices` and `/:project/evaluations` are *declared*,
just not as pages). Neither is a gap.

## A. On main, and this branch has neither a page nor a redirect

**Four are real and they are all governance:**

    /governance/agents        platform/app/src/pages/governance/agents.tsx
    /governance/analytics     platform/app/src/pages/governance/analytics.tsx
    /governance/insights      platform/app/src/pages/governance/insights.tsx
    /governance/signals       platform/app/src/pages/governance/signals.tsx

All four exist as real pages on main. None appears in the branch's route table,
none is contributed at install time, and none is redirected — so on this branch
those four addresses fall through to the catch-all `*` and render the 404 page.
Governance was clearly reworked rather than ported (the branch adds
`/governance/anomaly-rules`, `/governance/inventory` and
`/governance/inventory/:id`, which main does not have), so some of this may be
deliberate. **It has not been confirmed either way**, and that is the point:
four addresses that used to serve a screen now serve a 404, and nothing in the
repository records the decision.

Whoever picks this up: the question is not "do these files exist somewhere" but
"was the screen retired on purpose". If retired, they want a redirect entry in
`ui-route-table.ts` the way `/me/devices` and `/ops/queues` got one, so an old
link does not dead-end. If not retired, they are four dropped screens.

The other four in this class are noise, recorded so nobody re-derives them:
`/not-found` and `/[project]/not-found` (the branch serves 404 through the
catch-all `*` route instead of a named page — same behaviour, different
mechanism), `/dev/error-test` (a development-only error harness), and
`/settings/api-keys/utils` (a colocated helper my uppercase filter missed
because it is spelled lowercase).

## B. On main, redirected on this branch — intended, and they will read as differences

Sixteen addresses that main serves as pages, this branch answers with a
redirect. Every one looks like a deliberate consolidation:

    /[project]/evaluations                  -> /:project/experiments
    /[project]/evaluations/new              -> /:project/online-evaluations
    /[project]/evaluations/new/choose       -> /:project/online-evaluations
    /[project]/evaluations/wizard           -> /:project/experiments/workbench
    /[project]/messages                     -> /:project/traces
    /[project]/messages/[trace]             -> /:project/traces
    /[project]/messages/[trace]/[openTab]   -> /:project/traces
    /[project]/messages/[trace]/[openTab]/[span] -> /:project/traces
    /[project]/traces/[trace]               -> /:project/traces
    /admin                                  -> /ops/backoffice
    /gateway                                -> /gateway/virtual-keys
    /me/devices                             -> /me/configure?tab=devices
    /ops/backoffice                         -> /ops/backoffice/users
    /ops/projections                        -> /ops/event-sourcing/projections
    /ops/queues                             -> /ops
    /ops/scheduler                          -> /ops/event-sourcing/schedules

**Eleven of these are in `visualdiff.yaml`.** They will render one screen on the
base and a different screen on the candidate, and visualdiff will classify them
`changed` — correctly, and uselessly. Read this list before triaging a
visualdiff report: a `changed` row on any of these sixteen is the redirect
doing its job, not a regression. They are worth keeping in the route list
anyway, because the redirect *itself* is behaviour worth diffing — a redirect
that stopped redirecting is a real regression, and it would show up here.

## C. On this branch only — new or restored

    /:project/agent-testing        /:project/analytics/query   /:project/simulations
    /governance/anomaly-rules      /governance/inventory       /governance/inventory/:id
    /ops/projections/:runId        /*                          /settings/*

## What was changed as a result

`tools/visualdiff/visualdiff.yaml` gained the four governance routes from
section A (`agents`, `analytics`, `insights`, `signals`). They were in no
route list before, so no tool was measuring them. They should now surface as
`missing-on-candidate` in the next visualdiff run — which is the point: a
finding, in a report, rather than a fact nobody had.

Nothing else was changed. In particular no route table entry was added: whether
those four screens come back, or get a redirect, is a decision for whoever owns
governance, not for the tool that noticed.

---

# Appendix: a check that stops early reads as a check that passed

Found while unblocking the first visualdiff run, 2026-09-12. Recorded here
because it is the same shape as the gap this document is about — something real
that no check was reporting — and because it will look like a regression to
whoever meets it next.

## What happened

visualdiff's candidate prep runs `dev/scripts/ensure-built.mjs`, which builds
**three** packages: `langwatch`, `@langwatch/mcp-server` and `@langwatch/mail`.
Gate 1 opening on the SDK alone was necessary but not sufficient — `@langwatch/mail`
was the next gate behind it, and it failed on three errors in
`modules/scenario/contract`: two dangling `~/` monolith imports
(`~/components/variables/VariableMappingInput`, `~/server/evaluators/evaluator.service`)
and the implicit-any they caused.

Repointing them — declaring `AvailableSource`/`NestedField` in the contract that
uses them, taking `ComponentType`/`Field` from `@langwatch/workflow-contract`,
and `EvaluatorWithFields` from `@langwatch/evaluator-contract` — makes
`@langwatch/mail` build. It also takes the error counts from

    pnpm typecheck:one @langwatch/scenario-contract    3  ->   67
    pnpm typecheck                                     3  ->  134

which is what caused an earlier session to revert the same change.

## Why the number goes up, and why that is not a regression

`modules/scenario/contract`'s own script is

    "typecheck": "pnpm -w typecheck:declarations --project . && tsc --noEmit"

The declarations walk stops where it cannot resolve. While
`evaluator-attachments.ts` carried an unresolvable `~/` import, the walk
terminated there and reported 3. Resolve it and the walk continues into the rest
of the package and reports what was always behind it.

Measured, by stashing only the three changed files and re-running the identical
command:

    of the 134 at app level:  126 are TS2307 "Cannot find module"
                              110 of those are dangling `~/` monolith paths
                                0 are in either file that was edited
    both sides exit 1 — `pnpm typecheck` does not pass on this branch either way

So the change fixes its own 3 and **unmasks 131 pre-existing defects of the
identical class**. Reverting does not fix 131 errors; it re-hides them behind 3.
The exit code is the part to read, not the count.

## The part worth acting on

Nobody knew those 131 were there. They are more b383462d96 fallout — the same
root cause as `unserved-documented-operations-2026-09-12.md` — and they were
invisible for the same structural reason a route dropped from the route table is
invisible: **the tool that would have reported it stopped before it got there.**

Two things follow, neither of them done here:

1. `modules/scenario/contract` carries 55 dangling monolith imports (31 in
   `voice/`, 15 in `evaluations/`, 18 in `launch-scenario-run.service.ts`, the
   rest scattered). That is known, newly-visible debt, not a fresh break.
2. **Other contract packages were swept, and the concentration is local.**
   `git grep -l 'from "~/' HEAD -- modules/*/contract/src/` over the committed
   tree gives `modules/scenario/contract` 22 files (82 dangling import lines),
   `modules/suite/contract` 1, `modules/feature-flag/contract` 1, everything
   else 0. So this is one package with a concentration plus two singletons — a
   lane-sized job, not a drive-sized one.

That git-grep is also the cleanest proof that the change did not author these:
82 dangling lines exist across 22 files at HEAD, with no edit in the tree. Two
added contract dependencies cannot write them. If you meet 134 errors and reach
for a revert, that is the sentence to read first.

## Also worth knowing: the coupling to the SDK's codegen

`sdks/typescript/copy-types.sh` matched that dangling import **by regex** and
replaced it with inline declarations, because the CLI has no React tree. Remove
the import and the regex misses, the script exits 1, and
`pnpm --filter langwatch build` — gate 1 itself — fails through
`prebuild -> generate -> generate:server-types`. A plain `cp` is not a fix
either: `sdks/typescript` does not depend on `@langwatch/workflow-contract`, so
copying the file verbatim ships an import the published tarball and the release
binaries cannot resolve.

The contract edit and the codegen change are therefore strictly coupled in both
directions and belong in one commit. If you are about to change that import
block, read `sdks/typescript/copy-types.sh` first — the build will tell you, but
only after you have changed it.
