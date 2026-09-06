# Seam review of feat/strict-feature-layout-v0

The branch changes several hundred thousand lines, but the strict layout makes
them homogeneous. Risk concentrates in a few thousand lines; the rest is one
shape repeated. So: machines review the bulk, a human or Fable reads the seams
once, and Sonnet lanes emit findings for everything in between.

```
  bulk (~300k lines)        seams (~15k lines)        judgement
  ┌──────────────────┐      ┌─────────────────┐      ┌──────────────┐
  │ oxlint           │      │ packages/api    │      │ Fable, one   │
  │ architecture-lint│      │ compositions    │ ───► │ session per  │
  │ parity gate      │      │ security + authz│      │ seam, this   │
  │ per-package tests│      │ lint rules      │      │ file loaded  │
  │ visual diff, CI  │      └─────────────────┘      └──────────────┘
  └──────────────────┘             ▲
           ▲                       │ findings only (a few hundred tokens)
           │              ┌────────┴────────┐
    nobody reads these    │ Sonnet lanes    │  per feature package
                          └─────────────────┘
```

## 0. Spend nothing on what a check already proves

Push, let CI run, and read no line until it is green. Counters that must hold:
parity `THIS RUN FAILS: 0 unbound` (1 today, the browser-only viewport case),
oxlint errors 0 (44 today), architecture-lint hard findings 0 with the five
baseline files deleted, `pnpm typecheck:all` clean, boot smoke for api and
worker, the visual diff report with no unexplained row.

## 1. Seams, read fully once with Fable

One fresh session per seam with only this file and the seam's checklist loaded.
Stop when the checklist is answered.

### 1a. `packages/api/src/rest` and `src/trpc`

- Every family reaches the handler through one pipeline: policy, validation,
  idempotency, handler, error envelope, output validation. Name any bypass.
- `withIdempotency` stores and replays the bytes actually sent; a replay never
  re-runs the handler; a missing ledger refuses keyed requests by name and lets
  unkeyed creates through (`api-idempotency.composition.ts`).
- Error envelope: a `HandledError` reaches the wire as its `code`; anything
  else is `unknown` plus a trace id; no `message` names an env var or host.
- Decision 20: every family at `/api/v1` and `/api`, four families v1-only.
  List the four and confirm `v1Alias:false` is set on exactly those.
- tRPC: `validateOutput` follows `API_TRPC_VALIDATE_OUTPUT` per process;
  `createIsPublicProcedure` receives a middleware builder, not a procedure.
- Nothing in these two directories imports a feature package.

### 1b. Compositions

`apps/api/src/app/api-production.composition.ts` and
`apps/worker/src/app/worker-production.composition.ts`.

- For each port, which adapter, and is the same choice made in both processes
  where both compose the service. Diff the two lists.
- Only the API process runs migrations (`start:prepare:db`); worker and UI
  never do.
- AuthZ is installed before any route mounts; no route is mounted outside the
  security chain.
- No `as unknown as`; no stub adapter left in a production composition.
- Every `withIdempotency` endpoint has a runner (compose-time check).

### 1c. `apps/api/src/api-rest.security.ts` and `packages/features/authz/server`

- Fail closed: an unresolvable tenant, a missing key, an unknown scope each
  refuse. Trace every early `return` and every `?? true`.
- Project-scoped models always carry `projectId`; the multitenancy guard is
  installed on the one Prisma client both processes share.
- Share links: mint is bounded and the allowlist refuses what mint refuses.
- No RBAC vocabulary survives (grep `role`, `permission` outside authz).

### 1d. `packages/architecture-lint` rules and `.oxlintrc.architecture.json`

- Each rule's allow list is a design decision you can name; delete any allow
  you cannot.
- Debt registers (max-depth, complexity, cognitive complexity) can only
  shrink; no baseline file remains.
- `check-feature-parity.ts` counts only tagged scenarios; confirm no feature
  file reads green because it is untagged.

## 2. Sample the repetition

Read two packages completely with the grammar checklist: one core
(`packages/features/trace`) and one enterprise
(`packages/enterprise/features/governance`). Any defect class found is a grep
across the other packages, not another read.

Grammar checklist per package: `services/*.service.ts` static `create` over
ports; `repositories/` typed Prisma or ClickHouse only; `rules/` pure (no
`Date`, no I/O); `adapters/` implement one port each; `transport/api-rest` and
`api-trpc` call services only; web `model → behavior → ui`, one install export,
`screens/<owner>` and `surfaces/<id>` doors; every `it(` carries one verbatim
`@scenario` title.

## 3. Sonnet for breadth, Fable for judgement

Sonnet lanes run the review skills per package and emit findings only, in the
skills' finding format, to `dev/docs/plans/seam-review-2026-09-06/<package>.md`.
Fable reads the findings, never the source, and adjudicates each as fix, defer,
or false positive.

## 4. Merge ports as commits

`d4e51c8e22` (main 105613d379: langy local control, agent grants, ingest
keys), `60ca74941a` (OpenAPI generator), `bfb9cb4beb` (idempotency over
Response, TenantDirectoryService). For each: `git show --stat`, then read only
hunks touching tenancy, auth, idempotency, or the eventing pipeline. Skip
tests and web UI.

## 5. Questions, not "review this"

Each is a grep with a short answer:

- Which repositories are reachable from a route without a project id?
- Which services are composed in the worker but not the API, and vice versa?
- Which ports have exactly one adapter, and is that adapter the production one?
- Which `HandledError` codes have no presentation entry?
- Which `.feature` files carry zero binding tags?

## 6. Human in the loop

`.github/CODEOWNERS` names an owner for every seam above, so GitHub requires a
human review on those paths once "Require review from Code Owners" is on for
`main`. The complexity and cognitive-complexity registers live in
`.oxlintrc.architecture.json`, which is owned, so a function cannot join a
register without a person seeing the line appear.
