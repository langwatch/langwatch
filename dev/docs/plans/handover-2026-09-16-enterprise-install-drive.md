# Handover: the enterprise install drive — 2026-09-16 (rev 3)

You are the coordinator. Read `.claude/coordinator/COORDINATOR.md`, then this.
The live roster is `.claude/coordinator/LANES.md`; the drive's standing decision
is `.claude/manifests/BRIEF-governance-install.md`. One lane of this drive is
active: `gov-rest-serves-25`. The other three rows belong to a peer lint session
and are not yours.

## The goal, corrected against the report rather than restated

Rev 2 said 21 operations — 17 SCIM and 4 ingestion-templates. **That undercounts.
The measured figure is 25**, read out of `.apidiff/20260916-100008/findings.jsonl`
(313 findings, 81 `absent-on-branch`):

- **7** `/api/governance/ingestion-templates` routes: `GET`, `POST`, `GET /admin`,
  `POST /clone`, `GET /{id}`, `DELETE /{id}`, `PATCH /{id}/ottl-rules`
- **18** SCIM routes: 3 `/api/scim-tokens` and 15 `/api/scim/v2/*`

main served them; this branch answers 404. Get them served. Do not quote the
21 again — recount from the newest `findings.jsonl` if you need the number.

**No CLI or ingest governance route appears anywhere in the missing list.** That
fact is what makes the remaining work small, and it is checkable in one command:

```bash
python3 -c "
import json
rows=[json.loads(l) for l in open('.apidiff/20260916-100008/findings.jsonl')]
print([r['name'] for r in rows if r['kind']=='absent-on-branch' and 'governance' in r['name']])"
```

The user's ruling, from earlier the same day and not up for renegotiation:
enterprise module routes are **always mounted**, and an organization without the
entitlement gets a **refusal on the request**, never a 404 from an unmounted
route. SCIM already behaves this way (`plan_not_entitled`); nothing about the
refusal changes. Only the wiring does.

## Where the drive actually is

Seven commits, all by explicit pathspec, nothing of the three peer sessions swept:

| Commit | What it closed |
| ------ | -------------- |
| `64a6fa18a5` | the `defineChannels` lint fiction removed repo-wide |
| `5760338939` | governance + composition, 92 files |
| `36167dbde4` | scim onto ADR-144 |
| `036ed58a11` | the generator's enterprise tier, broken since 12 Sept |
| `f2903dca53` | three dead error codes retired, REST fixture repaired |
| `0b812f031d` | scim repointed onto the governance token that is provided |
| `3817590eed` | departments off the unsuppliable facade, onto the registry |

The chain to the 25 has three links. Two are closed:

- **The generator** resolves at enterprise tier and emits `governanceServer` and
  `scimServer`. Closed by `036ed58a11`.
- **SCIM** reads `["prisma"]`, is on ADR-144, and its whole use of the governance
  token is two operations — `departmentResolveByNameOrCreate` and
  `departmentAssignUser` (`services/scim-cost-center.service.ts:42,48`). Both now
  come off `repositories.departments`. Closed by `0b812f031d` + `3817590eed`.
- **`GovernanceApp` constructs.** Open, and the whole of what remains. It is the
  lane `gov-rest-serves-25`.

## What remains, and why it is small

`GovernanceRestApi` is **9 operations** — 2 department (landed) and 7 ingestion
template. Every one is repository-backed. The app's constructor builds only six
services, and five of them (`personalUsageDashboards`, three `cli*`, two
`ingest*`) serve contracts that are **not in the apidiff delta at all**.

So the remaining work is: write `MemoryIngestionTemplateRepository` (the one
missing twin of nineteen), add `ingestionTemplates` to the bundle, build the
already-existing `IngestionTemplateService` from it, point seven calls at it, and
put the CLI/ingest bag behind an optional slot so boot can supply what is left.

`.claude/manifests/gov-rest-serves-25.md` carries the steps.

## What apidiff cannot see, and why it still does not change the plan

apidiff fetches the served OpenAPI document (`/api/openapi.json`,
`tools/apidiff/spec.go:18`) and compares the operations in it. Anything not in
that document is invisible to it **on both sides**.

`governanceCliRest` declares eleven routes under `/api/auth/cli/*`, and six of
them carry no "governance" in the path (`bootstrap`, `budget-overview`,
`budget/status`, `personal-project`, `project-key`, `virtual-key`). A grep for
"governance" over `findings.jsonl` misses all of them - check the prefix, not the
word. Done properly, the answer is **zero findings name `/api/auth/cli` at all**,
of any kind.

`origin/main` does serve them (`git grep -ohE '"/api/auth/cli/[a-z/-]+"'
origin/main -- 'platform/**'`). So they are a real parity gap - just not one
apidiff measures, and **not one this drive introduces**: nothing installs
`governanceServer` today, so those routes 404 on the branch whether or not the
transport is in `.withTransports(...)`. Installing `governanceRest` alone is
strictly better than the status quo and never worse.

State it honestly when reporting: the 25 are what apidiff measures and what this
drive closes. The `/api/auth/cli/*` surface needs the 102-operation facade and
`createGovernanceInstallation`, and is its own drive.

**The other 56.** `absent-on-branch` totals 81; 25 are this drive and the rest
belong to other modules. The 143 `probe-failed` findings are not missing routes -
they are parameterised paths where an `{id}` resolves on one side only, so the
operation exists on both and simply is not behaviour-compared.

## The four `moduleApi("governance")` tokens

Rev 2 found two. There are **four**, and the two extra are declared in transport
files rather than the contract:

| Token | Declared at | Operations |
| ----- | ----------- | ---------- |
| `GovernanceApi` | `contract/src/governance.api.ts:337` | 102 |
| `GovernanceRestApi` | `contract/src/governance.api.ts:380` | 9 |
| `GovernanceCliRestApi` | `server/src/transport/governance-cli.rest.ts:51` | — |
| `GovernanceIngestRestApi` | `server/src/transport/governance-ingest.rest.ts:36` | — |

`LocalFeatureApis` keys bindings by **object identity**, not by the name passed to
`moduleApi`. The app's `contract` is `GovernanceRestApi`, so the other three
tokens are claimed by nothing. That is why the CLI and ingest transports could
not have resolved an app even if they were mounted, and it is the reason dropping
them from `.withTransports(...)` costs nothing today.

Collapsing the four is a later drive (option A), deliberately not now.

## Scoreboard

| | rev 2 | now |
| --- | --- | --- |
| declarations gate | 13 errors / 9 files | 13 / 9, unchanged |
| apidiff operations this drive owns | 21 (miscounted) | 25 (measured) |
| chain links closed | 0 of 3 | 2 of 3 |
| drive commits | 0 | 7 |

## Decisions taken — do NOT relitigate

- **`INGESTION_PULL_LISTING_OUTCOME` = `{ LISTED: "listed", REFUSED: "refused" }`,
  and it belongs in the governance contract.** Values recovered from the
  pre-conversion source; the constant is used only in `typeof` positions.
- **`aiToolProviders` keeps the static registry.** The only caller is
  `listProviderOptionsForAdmin`, which stamps `configured: has(providerKey)` — if
  the list were the organization's own providers that flag is constant-true.
- **`cliContacts`' invented 500-member cap is refused.**
  `OrganizationSupportContactService` already answers it over rows the module owns.
- **The cost-rollup subsystem stays in the composition package.** ~2,800 lines,
  nothing on the install path needs it. Own lane later, moved whole.
- **The ClickHouse move stays additive until the install.** Exporting repository
  classes from the module's `index.ts` was refused — `private-runtime-export`.
- **Gateway owns the budget overview.**
- **Spec buckets:** rebind where the behaviour lives elsewhere, rewrite where the
  code superseded the promise, `@unimplemented` only where genuinely absent.

- **Option C, taken 2026-09-16: install `governanceRest` only.** The CLI and
  ingest transports come out of `.withTransports(...)`; every method and every
  `implements` clause stays, and the CLI/ingest bag moves behind one optional
  slot. Justified because no CLI or ingest route is in the apidiff missing list,
  and because their tokens (`GovernanceCliRestApi`, `GovernanceIngestRestApi`)
  are claimed by no app, so those transports could never have resolved one.
  Reaching the 102-operation `GovernanceApi` means `createGovernanceInstallation`
  and its 30-slot options type - out of scope for parity, by decision.

## Traps that have each cost real time

- **No slice in this drive was verified by CI, and none could have been.** The
  package-suites job has been dead since `e702359c53`: two bare names in
  `.github/package-suites.excluded` made the runner exit before discovering a
  single package, and a suite that never starts cannot fail, so it read green
  throughout. Fixed by a peer session on 2026-09-17. Every "checks passed" in
  this drive's handoffs is a local run, which is what they say - but do not read
  a green CI on any of these commits as a second opinion, because there was not
  one.
- **The suite script is `test`, not `test:unit`** (`8337098ae3`, workspace-wide).
  Both governance modules re-verified under the new name after the rename:
  `@langwatch/enterprise-governance-server` 7 files / 65 tests,
  `@langwatch/enterprise-scim-server` 13 files / 108 tests.

- **`governance: []` in the generated members file is correct output, not a
  failure.** The generator derives that list from `static readonly reads` alone
  (`dev/scripts/generate-modules.mjs:53`); boot adds the chosen repository tier's
  own `requires` on top. A module that reads no process member prints `[]` and is
  right to. SCIM prints `["prisma"]` only because it has no repositories registry
  and builds its adapter from `members.prisma` itself. One lane lost most of a
  run to reading `[]` as the blocker, on a manifest that told it to.
- **Count the apidiff delta from `findings.jsonl`, never from a handover.** Two
  revisions carried 21 when the file says 25, and 4 governance routes when it
  says 7.

1. **`timeout` does not exist on macOS.** `timeout 420 pnpm ...` exits 127 having
   run nothing, and a grep over its empty output reports zero errors. That read as
   "the declaration build is clean" for one turn this session. Never wrap a check
   in `timeout` here.
2. **Trailing-quote import greps miss everything.** See above. Match the `.ts`.
3. **Sizing the conversion from one interface.** "562 lines across 4 files" came
   from `GovernanceInstallationOptions` (30 collaborators) and missed
   `GovernanceInfrastructure` (36 more, `governance.members.ts:33`). ~66
   collaborator slots, **none ever wired on this branch** — first-time wiring, not
   a conversion.
4. **A green check that proves nothing.** ClickHouse repositories declared
   `requires = ["clickhouse"]` while `create` took a resolver *function*;
   `AnyProvider` erases the parameter, so it typechecked and 39 tests passed. It
   would have thrown on first call.
5. **Bindings that are fiction.** Ten scenarios were bound to test files importing
   a module that never existed in that package. Parity counted them bound.
6. **`as unknown as` casts.** Five lanes have now produced them; all were sent
   back. `modules/trace/server/src/app/trace-composition.build.ts:230` still
   carries two, fixable by narrowing the resolver's return type to
   `Pick<ClickHouseClient, "insert" | "query">`.
7. **Manifests that name filenames.** `*.port.ts` is banned by
   `no-port-vocabulary` and `feature-source-layout`.
8. **TS6305 floods a direct `tsc`.** Unbuilt project references produce ~296
   "output file has not been built" errors and, worse, degrade same-package
   relative imports to `any`, hiding real errors. Exclude TS6305 before comparing,
   and treat a clean direct `tsc` as weak evidence. Non-TS6305 floor is ~208.

## Outstanding defects, none blocking

- **Two of `@langwatch/installed-modules`' three exports have no importers.**
  `./web` (`web-modules.generated.ts`) has zero - web modules install through
  `apps/ui/src/features/catalogue.json` instead, so this is residue from before
  that mechanism. `./members` (`server-module-members.generated.ts`) has zero
  too: the only references anywhere are the generator that writes it and
  `packages/architecture-enforcer/tests/generated-module-lists.unit.test.ts:36`,
  which reads the generator's in-memory output rather than the file. **Boot does
  not consult it** - it computes each module's members at runtime from `reads`
  plus the selected repository tier's `requires`. That is the deeper reason
  `governance: []` was never a failure signal, and it means the file presents as
  machinery while being documentation. `./server` has one consumer, `apps/api`,
  and earns its keep on a different argument: its 44 imports must resolve, so
  some manifest must declare them, and having the generator own
  `modules/package.json` is what keeps it from rewriting an app manifest people
  hand-edit. Worth a residue sweep to delete the two dead exports; not during a
  parity drive.

- `PersonalSourceTypeNotAllowedError` (`governance.errors.ts:60`) is a plain
  `Error`, so the allow-list refusal reaches customers as a generic unknown, while
  `ingestion_key_source_not_allowed` sits registered at `app-codes.ts:237` with
  **nothing throwing it**.
- `enterprise-trpc.composition.ts` still references the deleted `ScimPlanProvider`.
- `enterprise/modules/scim/server/server/src/app/server.members.ts` — note the
  doubled `server/server` — is scaffold debris imported by nothing.
- `prisma.ingestion-pull-run-projection.repository.ts` has a shape mismatch, and
  `ingestion-pull-run-projection.tenancy.integration.test.ts` a self-import bug;
  both pre-existing, both recorded in `.claude/handoffs/gov-dead-alias-gate.md`.
- Two scenario-bound tests (`pulledUsageCurrency`, `signedPulledMoney`) import a
  second dead pipeline, `@ee/.../pulled-usage-processing/schemas/events`, whose
  names now exist in `contract/src/pulled-usage.events.ts`. Field-shape
  compatibility unverified; both carry live `@scenario` bindings to
  `specs/governance/pulled-usage-cost-reporting.feature`.
- Three `pullerWorker*.unit.test.ts` files import a subject `../pullerWorker` that
  does not exist; the live worker is `IngestionPullWorkerService`. Before deleting
  them, confirm every `@scenario` they bind is re-bound in the newer suite —
  otherwise deleting silently unbinds it.

## How to run apidiff

```
.bin/apidiff/apidiff run -no-haven -main-ref <base> -branch-dir <clean worktree> \
  -report .apidiff/report-<date>.json -ledger .apidiff/ledger-<date>.json \
  -ledger-baseline .apidiff/ledger-20260916-r11.json
```

Use a **clean worktree** for `-branch-dir`: with `-no-haven` the branch instance is
that directory itself, so a dirty tree boots dirty. Read `credentialChecks` in the
report before any count.
## Next action

One lane is running: `gov-rest-serves-25`. When it lands, collect it, then run
apidiff at the enterprise tier. Nothing else is outstanding.

### The build tier: what is actually true, third revision of this answer

Rev 2 called it a decision for the user. Rev 3 called it "a prefix on the apidiff
command". **Both are wrong.** The prefix claim came from reading
`havenrun.Env` - which does pass `LANGWATCH_BUILD_TIER` through untouched - and
stopping there, without checking whether anything downstream regenerates.
Nothing does, on the path the drive documents. Traced properly:

| Path | Prepare steps | Regenerates? |
| ---- | ------------- | ------------ |
| `-no-haven` | `modularProfile.prepareArgvs`, `tools/apidiff/profile.go:52` - prisma generate, `langwatch` build, mcp-server build, `ensure:built` | **No.** `generate:modules` is not among them, and `ensure-built.mjs` does not call it. The committed core list boots and the variable is inert. |
| haven | `havenrun.PrepareCommands`, `tools/havenrun/prepare.go:53` - `env -u CI pnpm install --frozen-lockfile`, then `pnpm run start:prepare:files`, then `ensure-built.mjs` | **Yes, but too late.** |

"Too late" is the substantive finding. Since `036ed58a11` the generator derives
`modules/package.json` from the installed set, so at the enterprise tier it
rewrites that manifest from 44 dependencies to 49 - **after** the install has
already run. The five enterprise packages are never linked into
`modules/node_modules`, and boot dies with `ERR_MODULE_NOT_FOUND`. The lockfile
makes it worse in the other direction: its `modules` importer carries exactly 44
entries and **zero** enterprise ones, so a `--frozen-lockfile` install against a
regenerated manifest is rejected outright.

So the order any enterprise build needs is **generate, then install, then run** -
and the install cannot be frozen, because the lockfile is a core-tier artefact:

```bash
LANGWATCH_BUILD_TIER=enterprise node dev/scripts/generate-modules.mjs
env -u CI pnpm install --no-frozen-lockfile
```

Neither apidiff path does this today. Fixing apidiff properly means making the
tier an input to boot and moving generation ahead of install; that is its own
task and it is **not** needed to prove the routes are served (below).

### Proved: all 25 are served at the enterprise tier

`apps/api/src/tasks/openapi-document/openapi-generate.task.ts` builds the OpenAPI
document from `serverModules` and the modules' own REST declarations - no
database, no server, no stack. apidiff compares that same document, fetched from
a running instance at `/api/openapi.json` (`tools/apidiff/spec.go:18`), so an
operation in the generated document is one apidiff will see.

Run in a throwaway worktree at `9c250e6ea9`, both tiers, same tree:

| | core | enterprise |
| --- | --- | --- |
| families | 71 | 75 |
| declared routes | 314 | 340 |
| operations written | 285 | 311 |
| **the 25 this drive owns** | **0** | **25** |

The core column is the control: without it the enterprise column proves only that
the document contains routes, not that the tier is what put them there.

**Recount the way apidiff does, or you will read 15/25.** `CanonicalAliasPath`
(`tools/apidiff/spec.go:54`) collapses `/api/v1/<rest>` onto `/api/<rest>`, and
the branch publishes the governance and scim-token families under `/api/v1/`.
Paths carrying their own versioning (`/api/scim/v2/...`, `/api/otel/v1/...`) are
exempt and match literally. A naive string comparison finds the 15 `/api/scim/v2/*`
and misses the other ten, which are present and correctly spelled.

The recipe, which no apidiff path performs for you:

```bash
git worktree add --detach .claude/worktrees/ent-parity HEAD
cd .claude/worktrees/ent-parity
LANGWATCH_BUILD_TIER=enterprise node dev/scripts/generate-modules.mjs
env -u CI pnpm install --no-frozen-lockfile
pnpm --filter @langwatch/prisma-client run prisma:generate
pnpm --filter langwatch build && pnpm --filter @langwatch/mcp-server run build
pnpm run ensure:built
pnpm --filter @langwatch/platform-api task openapi-generate /tmp/openapi-enterprise.json
```

**What this does and does not establish.** It establishes that the enterprise
build declares and publishes all 25 operations, which is what apidiff measures.
It does **not** establish that they answer correctly at runtime: the document is
built from declarations without constructing an app or opening a connection. The
app's own evidence is separate and also green - 65 unit tests over the app and
its REST transport, and `tslsp-cli diagnostics` clean on both
`governance.server.ts` and `app/governance.app.ts`, which is the installer seam
the package's own `tsc --noEmit` never reaches because the declarations gate
fails first. A real boot is still owed.

### The boot graph resolves - checked, not assumed

Document generation evaluates each REST transport's router but never calls
`GovernanceApp.create`, so app construction was untested by everything above. The
way that fails at boot is an unresolved peer token, and that is checkable
statically. Drop this in the enterprise worktree as `apps/api/src/tasks/probe.ts`
and run it with `node --experimental-transform-types`:

```ts
import { serverModules } from "@langwatch/installed-modules/server";
const mods = serverModules as unknown as readonly any[];
const provided = new Map<unknown, string>();
for (const m of mods) if (m.apiContract) provided.set(m.apiContract, m.name);
for (const m of mods)
  for (const [slot, token] of Object.entries(m.dependencies ?? {}))
    if (!provided.has(token)) console.log(`UNRESOLVED ${m.name}: ${slot}`);
```

Result at the enterprise tier: 49 modules, 49 contracts, and **governance's three
dependencies all resolve** - `projects` from project, `organizations` from
organization, `permissions` from authz. SCIM resolves five of six from modules.

Seven slots across seven modules report unresolved, and **all seven are
pre-existing and handled by the composition root, not defects**:

- `auditLog` (agent, automation, evaluator, ops, scim, sso) - filled by
  `auditLogNullServer`, which `api-production.composition.ts:52` installs
  precisely when `audit-log` is absent from the generated list.
- `license` (entitlement) - `ActivatedLicenseSource` is
  `moduleApi<EntitlementSource>("licensing")` and is supplied by
  `.withProvided(ActivatedLicenseSource, licenseSource)`, a token provided
  directly rather than by a module, which is why it is not in the contract map.

So a token missing from that probe's output is not automatically a bug - check
`withProvided` and the null-server fallbacks before calling one. The probe's
value is that it separates "declared and resolvable" from "declared", and
governance and scim are both clean on the first.

### The first real boot, and the two breaks it found

A stack was booted at the enterprise tier in a throwaway worktree
(`haven up` in `.claude/worktrees/ent-parity`). Static checks had all passed; the
boot found two failures neither of them could see, which is the argument for
doing this before declaring a drive finished.

**1. `createScimService` - mine, fixed in `65712f4dd0`.** The backend crash-looped
on `module '@langwatch/enterprise-scim-server' does not export 'createScimService'`.
`36167dbde4` (this drive, scim onto ADR-144) removed four exports from the scim
server's `index.ts` and left `enterprise/packages/composition/api/src/index.ts`
re-exporting all four. `apps/api/src/app/api-production.composition.ts:36` imports
one unrelated symbol from that barrel (`createActivatedLicenseSource`), which is
enough to evaluate it and fail on the one value among the four. Three separate
gates missed it: `pnpm typecheck` covers three applications and this is one of the
~180 packages outside them; the package-suites job has been dead since
`e702359c53`; and no process installed the enterprise modules at all until this
boot.

**2. `rateLimiter` - not mine, still open, and it blocks every boot of this
branch.** With the first fixed, boot fails at:

```
fatal boot failure: Module "auth" reads the "rateLimiter" member,
which this process cannot supply.   (MissingMemberError)
  at createWorkerFoundationApps (apps/worker/src/app/worker-foundation-apps.composition.ts:180)
```

`651625d14f` (2026-09-16) made `modules/auth/server/src/app/auth.app.ts:158`
declare `reads("logger", "prisma", "redis", "rateLimiter")` and wired the **api**
to supply it (`api-production.composition.ts:249,434`). The worker installs auth
through its foundation apps and supplies no limiter - the file contains no
occurrence of the word. So this is ADR-144's refusal working exactly as designed,
naming the module and the member.

**It reproduces at the core tier**, so it is not this drive and not the enterprise
build: regenerate the same worktree with plain `node dev/scripts/generate-modules.mjs`
and the identical `MissingMemberError` appears. The worker composition is clean in
git, so no session is mid-fix on it.

Two candidate fixes, and choosing between them is an architecture decision rather
than a patch:

- the worker supplies a limiter (or a no-op) in its own member record, which asks
  what rate limiting means in a process with no public doors; or
- `auth`'s `reads` stops requiring one unconditionally, which asks whether the
  member is genuinely required by the module or only by its HTTP surface.

Do not guess between them. The owning change is `651625d14f`.

**Where this leaves the 25.** They are proved declared and their boot graph
resolves; they are not yet proved to answer, because no process on this branch
currently boots far enough to serve anything. That is blocked on the `rateLimiter`
decision, not on governance or scim.

### Then

1. **Teach apidiff the tier.** Generation must move ahead of the install, and the
   install cannot be frozen at the enterprise tier. Until that lands, apidiff
   measures the core build and will keep reporting the 25 as missing - which is
   now a limitation of the harness, not of the branch.
2. **A real boot.** The document proves declaration, not behaviour.
3. **The `/api/auth/cli/*` surface**, eleven routes main serves and apidiff does
   not measure. Needs the 102-operation facade; its own drive.
4. Follow-ups in the user's stated order: the two-image split (OSS and
   enterprise), then option A, collapsing the four `moduleApi("governance")`
   tokens into one.

**Known and deferred:** `@langwatch/infrastructure` is still not a dependency of
the governance server package. Adding it regenerates the lockfile, which absorbs
every other session's uncommitted `package.json` edits, and three peer sessions
are live in this checkout. It is not needed for the 25 - the app reads no process
member - so it waits for the lane that genuinely imports it.

The throwaway worktree is left at `.claude/worktrees/ent-parity`, installed and
built, so the check above is one command to repeat. `git worktree remove
.claude/worktrees/ent-parity --force` when it is no longer wanted.
