# Drive: get `apidiff` to report no behavioural difference against `origin/main`

Written 2026-09-12, end of the fourth session. **This is the ENTRY POINT.** It
supersedes `handover-2026-09-12-apidiff-3.md`, which is now a reference for how
the diagnosis was reached rather than for what to do next.

Branch `feat/strict-feature-layout-v0`. Three commits added this session:

    f754346275  the scenario contract owns its mapping shapes, and the SDK's copy step learns the new spelling
    579a0da40c  apidiff passes --project-directory, so compose can find the .env it has always needed
    e8b0a63c62  the tasks process boots again: a wrong channel import and three interfaces used as classes

None pushed. The working tree carries two files owned by the visualdiff
session (`tools/visualdiff/visualdiff.yaml`, `route-surface-parity-2026-09-12.md`),
uncommitted on purpose.

## Read this first: the pattern behind every wall this drive has hit

Five times now — four this session — the thing blocking progress was **a
measurement that read healthy while the tree was not**. Not one of them was a
hard failure anyone could see; each was a number that looked fine because the
tool that produced it had stopped early, looked in the wrong place, or asserted
the bug was correct.

- `openapi-check` reported 0 removed / 0 added / 0 changed, because once the
  document is generated from the declarations an operation nothing declares is
  simply absent rather than "removed". 70 unserved operations became invisible
  the moment the document was refrozen.
- `pnpm typecheck:one @langwatch/scenario-contract` reported **3** errors, because
  the declarations walk stops at the first unresolvable import. Behind those 3
  sat 64 more of the same class. The previous session reverted a correct change
  on the strength of that number.
- `TestComposeArgs` **passed**, because it asserted the argument list without
  `--project-directory` — the exact shape that cannot work. A passing test
  asserting a bug is worse than no test: it converts "nobody checked" into
  "somebody checked and it is fine".
- A glob of `modules/*/server/src/transport/*.rest.ts` returned a clean "no
  declaration found", because it reached neither the enterprise tree nor the
  `api-rest/` subdirectory naming.
- `grep -cE 'error TS'` over a typecheck run returned **0** while that run was
  exiting 1, because the output is a grouped summary and the pattern never
  matched it.

When a check on this branch says something is fine, ask what it would have to
see to say otherwise. That question has been worth more this session than any
individual fix.

## Gates: what it actually takes to prepare an instance

`dev/scripts/ensure-built.mjs:15-17` builds **three** packages, and visualdiff
runs it. Gate 1 on the SDK alone was necessary but never sufficient:

    pnpm --filter langwatch build             exit 0
    pnpm --filter @langwatch/mcp-server build  exit 0
    pnpm --filter @langwatch/mail build        exit 0

All three are green as of `e8b0a63c62`. apidiff additionally runs
`pnpm prisma:migrate`, which boots `apps/tasks` — that was the fourth wall and
is fixed in the same commit.

## The coupled pair, and why it must never be split

`sdks/typescript/copy-types.sh` used to match this import **verbatim** with a
regex and `process.exit(1)` when it missed:

    import type { AvailableSource, NestedField } from "~/components/variables/VariableMappingInput";

So removing that dangling monolith import from
`modules/scenario/contract/src/evaluator-attachments.ts` — obviously the right
thing — breaks `pnpm --filter langwatch build`, which is gate 1. The contract
half and the SDK half are inseparable in both directions and landed as one
commit.

A plain `cp` is **not** the alternative: `sdks/typescript` has no dependency on
`@langwatch/workflow-contract`, so copying the module verbatim ships an import
the published tarball and all five release binaries cannot resolve, and it
would surface at release rather than at build. The replacement step now lives
in `sdks/typescript/scripts/generate-evaluator-attachments.mjs`, accepts both
import spellings, and fails loudly naming what it looked for.

**Delete the old spelling's branch in that script once the contract has
settled.** It is there only so a revert could not re-break the build.

## The 3 -> 134 typecheck number, and why reverting is wrong

    pnpm typecheck                                   exit 1,   3 errors  ->  exit 1, 134 errors
    pnpm typecheck:one @langwatch/scenario-contract   3 -> 67

**Read the exit codes.** `pnpm typecheck` fails on this branch with or without
the change; no gate changes colour. 126 of the 134 are TS2307, 110 of those
dangling `~/` monolith paths, and **zero** are in either edited file.

Proof the change did not author them, independent of any tool's traversal:

    git grep -l 'from "~/' HEAD -- modules/scenario/contract/src/

returns 22 files and 82 import lines in the committed tree, concentrated in
`voice/` and `evaluations/`. Two contract dependencies cannot write 82 lines of
`~/` imports.

Repo-wide the masking is only three packages: `modules/scenario/contract` (22
files), `modules/suite/contract` (1), `modules/feature-flag/contract` (1). That
is a lane-sized job, not a drive-sized one.

### A correction to f754346275's commit message

That message quotes `pnpm typecheck` going "3 -> 134". Literally true as reported
lines, and misleading: **134 is 67 x 2** — one set of 67 errors, reported once
per application, not 134 distinct defects. Confirmed from both ends: the
per-application split is 63 TS2307 + 3 TS7006 + 1 TS2366 = 67, and the fanout's
is exactly double each. See the next section for why the applications' own
`tsc` never ran on either side.

## `pnpm typecheck` has never type-checked any application

Found by the visualdiff session, corroborated here independently. Each
application's `typecheck` script is:

    pnpm -w typecheck:declarations --project ./tsconfig.declarations.json && tsc --noEmit -p tsconfig.test.json

The declarations pre-pass fails (those 67), so **the `&&` short-circuits and
`tsc --noEmit` never runs**. Everything in `apps/api`, `apps/worker` and
`apps/ui` is currently unchecked and reads as checked, on this branch, in the
command CLAUDE.md tells every contributor to run and the one CI runs.

Run directly, `tsc --noEmit -p apps/api/tsconfig.test.json` reports **hundreds**
of errors (71 TS7006, 61 TS2304, 47 TS2741, 40 TS2307, 38 TS2345, ...). That is
the real state of the application's types.

This is the single most consequential finding of the session, because every
defect below accumulated behind it.

## The boot walls, in the order they appear

apidiff's `-no-haven` path runs install -> migrate -> seed -> start, per
instance. Six walls sat behind gate 1, each invisible until the one before it
was cleared. All are fixed except where noted.

1. **SDK build** — the coupled pair. `f754346275`.
2. **compose** — apidiff never passed `--project-directory`, so compose
   resolved `env_file: .env` against `dev/`. Broke `up` as well as `down`.
   A passing `TestComposeArgs` asserted the broken argument list. `579a0da40c`.
3. **`apps/tasks` could not boot** — four defects in one chain: a channel
   imported from the module that declares the abstract rather than the one
   holding its memory twin, and three cases of `class X extends <interface>`.
   `e8b0a63c62`.
4. **goose was not installed** — `clickhouse-migrate` shells out to
   `which goose`. `dev/compose.dev.yml:183` pins v3.26.0 and curls it, but only
   INSIDE the container; nothing installs it on the host, so every non-container
   ClickHouse migration hits this. Installed machine-wide with
   `go install github.com/pressly/goose/v3/cmd/goose@v3.26.0` (lands in
   `~/go/bin`, already on PATH beside haven; `rm ~/go/bin/goose` to undo).
   **Not fixed in the repo** — nothing documents or installs it for the host.
5. **seed referenced an undefined identifier** — `TEST_SUITE_ENTERPRISE_LICENSE_KEY`
   at `packages/prisma-client/prisma/seed.ts:177`, with the import at line 70
   binding `ENTERPRISE_LICENSE_KEY` and going unused. Merge fallout from
   `b5320f7103`. Aliased.
6. **the api could not boot, silently** — three defects. `70bc7a0ab6`, and the
   next section, because the first of them is a lesson rather than a bug.

## The api exited 1 having printed nothing

`bootApi`'s catch was `catch { process.exitCode = 1 }`, with a comment
explaining that a boot failure had already reached the error stream, so
re-reporting would read as two failures. That holds **only once the process has
a logger** — and the boot seam resolves secrets and parses config before that.
So the failures most worth seeing were exactly the ones nothing had reported,
and the process exited 1 with an empty log under a supervisor that can only say
"exit status 1".

`apps/tasks` has always logged here (`tasks.entrypoint.main.ts:106`). `apps/api`
now does the same. Behind the silence were:

- **An empty environment variable was not read as absent.**
  `Config.optionalSecret` is `z.string().min(1).optional()`, and `""` is not
  `undefined`, so the `optional()` branch was unreachable for any key written
  `FOO=` — which is how every `.env.example` writes "not configured". The api
  refused to boot over five credentials it does not need. Fixed in
  `packages/config`, so every process gets it. `stated()` in
  `gateway.config.ts` already had the right reading, one package over.
- **Nothing provided the audit log.** `modules/audit-log` publishes a contract
  and no core server half — the implementation is `enterprise/modules/audit-log`
  — so a core build installs nothing for the `audit-log` token while `agent`,
  `evaluator` and `ops` each declare a REQUIRED dependency on it.
  `@langwatch/audit-log-null` exists for exactly this and both `apps/api` and
  `apps/worker` already declared the dependency; only the install line was
  missing. **`apps/worker` still does not install it** — expect the same
  `MissingProviderError` once the worker gets past its own earlier walls.

## Wall 7: the gateway secrets (fixed in the harness, open for haven)

The api refuses to boot unless LW_GATEWAY_INTERNAL_SECRET, LW_GATEWAY_JWT_SECRET
and LW_VIRTUAL_KEY_PEPPER are all absent or all at least 32 characters. This
machine's `.env` carries 12-character placeholders in all three, so the refusal
is **correct** — the code is working. apidiff now composes its own throwaway
trio (`f38361a0c0`); the visualdiff session does the equivalent inside its own
copied worktree `.env`, substituting only an absent-or-too-short value and
announcing it per stack.

Neither is a fix for a real local stack. `openssl rand -hex 32` for each is,
and it is the user's call: rotating `LW_VIRTUAL_KEY_PEPPER` invalidates
whatever virtual keys exist in their local database.

## Wall 8: THIS IS WHERE THE DRIVE NOW STOPS

The branch api gets through config, secrets and the audit-log provider, and
then refuses at member claiming:

    MissingMemberError: Module "model-provider" reads the "credentials" member,
    which this process cannot supply.

`PostgresModelProviderRepositories.requires` is `["prisma", "credentials"]`
(`modules/model-provider/server/src/repositories/prisma/prisma.model-provider.repositories.ts:16`),
and **`credentials` is not a platform member at all** — `MEMBER_NAMES`
(`packages/infrastructure/src/members.ts:147`) lists fourteen and that is not
one of them. It is a `ModelProviderCredentialCodec`, a module-specific
abstract class (`encode`/`tryDecode`), and `ModelProviderInfrastructure` does
not declare it either. So nothing on either side of the seam provides it.

Note `modules/server-module-members.generated.ts` says `"model-provider": []`,
which disagrees with the repository's own `requires`. That is the stale-generated-file
trap the previous handover named, in a second instance.

**The recovery source is known**, by this drive's own method:

    git show b383462d96^:apps/api/src/app/api-model-provider.composition.ts

266 lines, deleted by that commit. Its `apiModelProviderParts` returns exactly
the missing set — `credentials`, `catalog`, `translation`, `ids`,
`codexTokenRefresher`, `connectionRateLimiter` — and its own comment says the
installed module asks this process for the same set through `withPersistence`
and `withInfrastructure`. Restoring that wiring is the next action and it is a
lane, not a patch: eight collaborators, and a decision about whether the codec
is built from the platform's `encryption` member or stays a module answer.

It was left undone deliberately. Improvising a module's dependency seam at
00:40 without its owner is how a drive ships an architecture decision nobody
made.

## Two classes of defect that no check in this repository can see

Both are shapes TypeScript accepts and Node's type-stripping runtime rejects.
The fix for the class is to make one tool see what the other sees — a lint
rule — not to fix the instances and move on.

**ERASED** — `class X extends Y` where `Y` is an interface, or is imported with
a `type` specifier. The type system is satisfied; the binding is erased; the
failure is a `ReferenceError` at class-definition time, so it fails at BOOT,
before any test or request. Three were fixed in `apps/tasks`. A detector the
visualdiff session wrote and self-tests
(`dev/scripts/find-erased-extends.mjs`, uncommitted) finds **56 more, all in
apps/worker**. Not yet confirmed against a direct `tsc` run.

**UNEXTENDED** — a relative import with no file extension. TypeScript accepts
it; Node ESM under type-stripping does not, and it fails at **link** time,
strictly before any module body evaluates. 3,930 repo-wide, but almost all in
trees that are bundled (`sdks/typescript` by tsup, `apps/ui` by Vite) or
resolved by vitest. Filtered to code that boots under Node ESM: **110
specifiers across 51 files**, concentrated in `modules/scenario/contract` (41),
`enterprise/packages/composition/api` (26), `enterprise/modules/governance/server`
(25) and `modules/analytics/server` (13).

The worker dies on one of these before it reaches any of the 56, which is why
the 56 are invisible even to a real boot: there is an earlier wall in front of
them.

## Ownership and coordination this session

Two sessions worked the same checkout. It cost one run and produced the
session's two best findings, so the arrangement is worth keeping, with the rule
that was missing: **"no peer running" and "no peer editing" are different
facts.** Re-ping before touching shared files, not just before booting.

- This drive: `apps/api`, `apps/tasks`, `sdks/typescript`, `tools/apidiff`,
  `packages/config`, `modules/**`.
- The visualdiff session: `tools/visualdiff`, `.visualdiff`,
  `specs/tooling/visualdiff*.feature`, plus `dev/scripts/find-erased-extends.mjs`.
- Resource interlock: an apidiff run boots the branch **in place** and cannot
  tolerate concurrency; visualdiff uses detached worktrees of committed refs
  and can always be second.

## The joint verdict: neither process boots, so neither tool can run

Written after both sessions stopped. The visualdiff session's own handover is
`dev/docs/plans/handover-2026-09-13-visualdiff.md`; this is the short version,
and it supersedes any reading of this document that treats apidiff's remaining
work as tool-shaped.

    apps/api     stops at model-provider's `credentials` member (wall 8)
    apps/worker  stops at 163 value imports that cannot resolve at link time

apidiff boots only the api, so it is blocked by the first alone. visualdiff
needs both, because haven's backend lane runs them in one process. **No flag on
either tool changes this.** The next action for the drive is not another run: it
is the composition lane, and `.claude/manifests/worker-composition-green.md`
already exists as the right home for it.

The worker's walls, cleared in this order by the visualdiff session and each
hidden behind the one before — the same stacking property that produced this
document's wall list:

    1. 110 extensionless relative imports (UNEXTENDED)
    2. a stale package `exports` entry pointing at a file f054ab2baf deleted
    3. 19 interfaces imported in value position
    4. 35 f054ab2baf renames, each now an interface, each needing three coupled
       edits: rename + `import type` + `extends` -> `implements` with `super()` dropped

Then the 163, of which **none has a single unambiguous rename candidate** —
which is why that session stopped rather than guessing. Behind those sit the 56
ERASED, unreachable until link time succeeds.

Two detectors are left in the tree, both self-testing before every scan, both
verified from this session independently:

    dev/scripts/find-erased-extends.mjs        56 sites
    dev/scripts/find-unresolvable-imports.mjs  163 sites, a rename proposal per site

The second is the one the lane wants: it prints `file:line Name -> proposal` and
says "nothing declared; port it from history" where there is no candidate.
Concentrations: `enterprise/packages/composition` 22, `modules/automation/server`
15, `modules/trace/server` 11, `modules/scenario/server` 11, `apps/worker/src` 11.

One warning from that session worth carrying, because it is this document's
coupling lesson at smaller scale: a type-import pass converted
`IngestionKeyRepository` to `import type` and left its `extends` in place,
manufacturing a 57th ERASED site that had not existed. **The fix for one class
can create another if you apply half of a coupled edit.** The detector caught
it; a person would not have.

**The visualdiff session's tree changes are uncommitted** — the 110-specifier
pass, the exports repoint, the type-import pass, the 35 renames, the two
detectors, the gateway-secret substitution and its handover. That session
commits only when asked. Decide whether to commit them before anything else
touches those files.

## What is still open

1. **apidiff has still never produced a report**, and now stops at wall 8
   above — the model-provider `credentials` member. Everything before it is
   cleared: install, migrate, seed, scim provisioning, fixtures, and the api's
   config, secrets and module composition. The command is unchanged:

       .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json \
         -report dev/docs/plans/apidiff-report-2026-09-12.json

   Exit 1 with findings is success. Exit 2 is another wall.
2. **The 70 unserved documented operations** are untouched; see
   `unserved-documented-operations-2026-09-12.md`. When a report exists, split
   them three ways — documented-and-answering (the list is stale),
   documented-and-declared-but-not-answering (an orphaned mount, the cheap
   fix), documented-and-not-declared (genuinely dropped). Note apidiff excludes
   `/api/gateway` by default, so those 8 cannot appear.
3. **The worker cannot boot** — UNEXTENDED at link time, then probably 56
   ERASED behind it, then probably the audit-log provider. A lane, in that
   forced order.
4. **`pnpm typecheck` checking nothing** wants fixing before anything else is
   measured by it.
5. **Gateway secrets in the developer `.env`** are 12-character placeholders.
   The api's refusal is correct. apidiff injects its own; haven cannot, so a
   real local stack needs the user to generate them
   (`openssl rand -hex 32`). Not done here: rotating `LW_VIRTUAL_KEY_PEPPER`
   invalidates existing local virtual keys, which is the user's call.
6. **Enterprise tier still broken at dependency resolution** (open decision 1
   from the previous handover, unchanged): `LANGWATCH_BUILD_TIER=enterprise`
   dies on `Cannot find package '@langwatch/enterprise-licensing-server'`.
