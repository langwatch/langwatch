# Work board for #7536: signed-off work anyone can claim

Every item here is ruled and needs no question: pick one, claim it, open a PR against
`feat/strict-feature-layout-v0`. The board in the PR description is the live claim list; this file
holds the full outlines.

## How to claim

1. Comment on #7536: `claim W-xx` (one item per agent at a time).
2. Branch from `feat/strict-feature-layout-v0` as `feat/w-xx-<slug>` and open a **draft** PR against
   `feat/strict-feature-layout-v0` titled `[W-xx] <title>`.
3. Stay inside the item's paths. If the work needs a path outside them, a new peer edge, a contract
   change in another module, or anything the outline does not cover, stop and comment on your PR; do not
   decide it yourself.
4. Mark the PR ready when the item's checks pass. The coordinator reviews, merges and ticks the board.
5. A claim with no push for 24 hours is released.

## Scope is fixed: decisions are not yours to make

An item is a scoped, already-decided piece of work. The decisions in it were made by Alex; the agent
doing it carries them out and makes none of its own.

- **No new architecture decisions.** Do not add a module, a peer edge (`static dependencies`), an `*Api`
  operation, a contract or event shape, a fact type, a table or column, a permission, a route, a framework
  API or a wire change, unless the item's outline names it. If the work seems to need one, stop and say so
  on your PR with the options; the coordinator takes it to Alex.
- **No slop.** No changes outside the item's paths, no drive-by refactors or renames, no speculative
  abstractions or options, no dead code, no TODOs, no comments that restate the code, no duplicated
  helpers. Write the code the way the surrounding code is written.
- **Nothing incorrect.** Follow the record (`dev/docs/ARCHITECTURE.md`) and the item's plan as written; if
  the plan and the code disagree, stop and ask rather than pick one.

## Definition of done (the review checks every line)

1. **Architecture rules pass for what the item fixes.** The findings the item targets are gone
   (`pnpm lint:architecture --policies <ids>` for the policies it touches, `pnpm lint:changed`), and the
   PR description shows the before and after counts.
2. **No new findings anywhere.** `pnpm lint:architecture` and `pnpm lint:changed` report nothing new
   against the base; the peer-cycles count does not rise; the deleted-spellings test shows no rise.
3. **Spec first and bound.** Every behaviour the item adds or changes has a scenario in the owning feature
   file, bound by `/** @scenario "<title>" */` on a test that proves it; `check:feature-parity` shows no new
   unbound row in touched specs.
4. **Checks green:** oxfmt and `oxlint --quiet --type-aware` on touched files; the touched packages' tests
   (`VITEST_MAX_WORKERS=2`); `pnpm --filter <pkg> typecheck` for every touched package; `pnpm check:readmes`.
5. **The PR description** lists the item id, what changed, the checks with results, and anything stopped
   on. A PR that adds a finding, widens scope or makes an undecided choice is sent back, not merged.

## What every item must follow

- Read `CLAUDE.md`, `dev/docs/ARCHITECTURE.md` (§3 modules, §5 peers, §8 routes, §15 deleted spellings) and
  the nearest generated `README.md` (`modules/<id>/README.md`) before editing.
- Spec first: a scenario in the owning feature file covers the behaviour, tagged with its level, bound by
  `/** @scenario "<title>" */` on the test that proves it.
- No new foreign key or `@relation`; migrations are additive (nullable or default).
- Checks: `pnpm exec oxfmt --write` and `pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc` on
  touched files; the touched packages' tests (`VITEST_MAX_WORKERS=2 pnpm --filter <pkg> test`); `pnpm
--filter <pkg> typecheck`; `pnpm --filter @langwatch/architecture-enforcer check:feature-parity` lines for
  touched specs; `pnpm check:readmes` if you change a module's statics, peers, tables or routes (run
  `pnpm generate:readmes`).
- British English, no em dashes, comments five lines maximum, Conventional Commits, no secrets.

## Ready now

### W-01 Guard against new foreign keys and relations (S)

Ruling: existing relations stay; no new `@relation` or FOREIGN KEY (rulings 2026-10-06, line 244).

- A shrink-only baseline of `@relation` lines in `packages/prisma-client/prisma/schema.prisma`, checked by a
  test in `packages/architecture-enforcer` (count may fall, never rise).
- The migration safety scanner refuses a new migration containing `FOREIGN KEY` or `REFERENCES`.
- Paths: `packages/architecture-enforcer/**`, the migration scanner, `.claude/skills/postgres-migration/**`
  (one line). Plan background: `dev/docs/plans/no-relations-2026-10-06.md` §1 (survey only; its removal
  slices are not executed).

### W-02 API bypass guards 1 to 4 (M)

Plan: `dev/docs/plans/api-framework-bypass-2026-10-05.md`, "Guards so it cannot come back".

- 1: credential readers (`*CredentialOfRequest`, `browserCallerOfRequest`, `principalOfCredential`,
  `extractBearer*`) only in `packages/api`, `packages/process`, `modules/auth`.
- 2: no auth-header reads (`authorization`, `x-auth-token`, `x-api-key`, `x-project-id`) in transport, app or
  `*.module.ts` files.
- 3: `withRawBody` takes a required `because`; `JSON.parse` of a raw body or input in a transport is an error;
  no `hono/http-exception` in modules.
- 4: escape-kind declarations are flagged; a handler pairing `admitX` with an operation is caught.
- Each rule ships at error only when the tree is clean for it; these are the few rules that accept a
  justified disable. Paths: `packages/oxlint-rules/**`, plus fixes at the flagged call sites.

### W-03 Restore Node default metrics (S)

Ruling: restore `collectDefaultMetrics` (main had it; a regression); an unconfigured metrics door stays
404 and boot names the missing token. Paths: the process metrics setup in `packages/observability` or
`packages/process` (find where the registry is built), a scenario in `specs/server`.

### W-04 Python SDK e2e against the branch stack (S)

Ruling: point the Python SDK e2e job at this branch's own stack instead of production. The regenerated
client calls `/api/v1/prompts/tags*`, which the branch serves and main does not. Paths: the Python SDK
workflow in `.github/workflows/`; `go run ./cmd/ciguard` must pass.

### W-06 Oversized payloads: operator surface and ops comment (S)

Plan: `dev/docs/plans/oversized-payloads-2026-10-06.md` §5 slices 4 and 6 (slices 1, 2, 3 and 5 landed).

- Slice 4: one lifecycle table listing every object-storage prefix and minimum retention in the chart
  values docs, `.env.example` and the self-hosting docs page, and the generalised Azure confirmation flag.
- Slice 6: `MONITORED_TABLES` comment in `modules/ops` no longer names evaluation inputs.
- Paths: `charts/**` (docs and comments only), `.env.example`, `docs/self-hosting/**`, `modules/ops/**`.

### W-07 ARCHITECTURE.md §16 renames (M)

The record's §16 lists target names that have not landed. Land: `hostedMembers` to `hostedStores` (3
files); the "store client" vocabulary and `bootInstalledProcess({ members })`; the `secrets.into` record
form; and refresh §16's stale text (`browserModules` is populated; E1 to E8 are built). Leave
"capabilities" to host-services for a second claim (W-08). Paths: the files each rename touches; §16.

### W-09 Ops bug-report bot secret into ops-contract (S)

`modules/ops/process/src/app/ops.app.ts` loads its Slack bug-report bot secret inline; move the
`Secret.load` into ops-contract's secrets leaf like every other module (record §3, CLAUDE.md "module code
never reads process.env"). Paths: `modules/ops/**`.

### W-10 Generated READMEs: rule, skills and CI (M)

Plan: `dev/docs/plans/module-readmes-2026-10-06.md` §6 and §5.4. Add the path-scoped rule
`.claude/rules/module-readme.md`; new skills `ownership` and `readmes`; point `module`, `repo-tree`,
`architecture-guide`, `api-transports`, `eventing-and-worker`, `process-module`, `browser-module`,
`module-dependencies`, `architecture-review` and `coordinator` at the pages; wire `pnpm check:readmes`
into `go-ci.yaml` (`generated` job) and the prepare-generated-files action. Do not edit `tools/readmegen`
(a lane owns it). Paths: `.claude/rules/**`, `.claude/skills/**`, `.github/**`.

### W-11 Governance anomaly alerts onto webhook endpoints (L)

Rulings request delivery Q1 to Q3. `requestDelivery` (webhook outbox intent) is built; governance anomaly
alerts still post inline `{ type: "webhook", url, sharedSecret }` destinations from
`anomaly-alert-dispatcher.service.ts`.

- A governance task migrates each inline destination to a webhook endpoint created through `WebhookApi`,
  rewrites the rule to `{ type: "webhook_endpoint", endpointId }`; the rule form picks an endpoint.
- Migrated endpoints keep main's legacy body (one raw alert per POST, unbatched) and `sha256=` signing;
  every other endpoint, new or old, stays envelope and `t=,v1=`. Needs a nullable scheme/format column on
  `WebhookEndpoint` (additive migration).
- A new event type joins `WEBHOOK_EVENT_TYPES` (for example `governance.anomaly_alert.triggered`).
- Plan gate: an organisation with governance but without webhook endpoints must not lose alerts silently;
  raise it on the PR before choosing.
- Paths: `enterprise/modules/governance/**`, `modules/webhook/**`, schema plus one migration.

### W-12 Peer-cycles cheap leftovers (S)

The experiment-to-suite cut landed without an integration proof, and an unused `@langwatch/suite-contract`
dependency remains. Add the composition test proving experiment runs without suite, remove the dependency
(`pnpm install` to update the lockfile). Paths: `modules/experiment/**`, `pnpm-lock.yaml`.

### W-13 Slack mutations gated by `project:view` (S)

`modules/slack/process/src/transport/slack.trpc.ts` gates `create`, `update` and `delete` with
`project:view`. Compare with main (`git show origin/main:` the slack router): "main decides". If main
required a manage permission, port it with a scenario; if main also used view, comment on the PR instead.
Paths: `modules/slack/**`.

### W-14 Migrations S2 Manifests and read side (L)

Plan: `dev/docs/plans/migrations-rethink-2026-10-06.md` §8 S2 (S1 ledger landed in `packages/upgrade`).
The stamp generator in the release PR; manifests backfilled since the LTS; `upgrade status` and `plan`;
the reader the ops page uses. S3 and S4 follow (claim separately once S2 merges). Paths:
`packages/upgrade/**`, `apps/tasks/**`, the release workflow.

## Opens when its dependency lands

| Item                                                                                                                                     | Opens after                                     | Outline                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| W-20 Usage counting move (Q73; ruling D1: entitlement folds usage's limit facts on SaaS, self-hosted keeps its local count)              | peer cut E1 (entitlement)                       | move counting, warnings and the sweep from entitlement to usage                         |
| W-21 Generated READMEs: browser pages (R5) and zod printer (R6)                                                                          | readmegen-2 lane                                | `tools/readmegen`                                                                       |
| W-22 Package groups in package.json (`"langwatch": { "group": … }`, closed list, `--check` refuses a package without one)                | readmegen-2 lane                                | every `packages/*/package.json`, `tools/readmegen`                                      |
| W-05 Permission sweeps, the remaining two (Q133: an apps/api sweep over the installed routes, a boot-time refusal, a type-level refusal) | api-shared-path lane (owns packages/api)        | `packages/api/**`, `apps/api/src/__tests__/**`                                          |
| W-08 "Capabilities" to host-services vocabulary (§16)                                                                                    | scope-knot-q2 lane (owns packages/browser-host) | `packages/browser`, `packages/browser-host`, every `*.web.ts`, the browser-module skill |
| W-23 to W-30 Peer-cycle batch B2 cuts (G, S2, AL, E2, ID, P, EV; plan §4)                                                                | batch B1 and the shared-path declaration        | one claim per cut, as listed in the plan                                                |
