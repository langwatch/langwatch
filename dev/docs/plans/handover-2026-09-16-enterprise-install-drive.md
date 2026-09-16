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

### The build tier is not a decision, and rev 2 was wrong to call it one

Rev 2 said the install was "blocked on one decision that is the user's", between
amending ADR-144 §6, forcing the flag in `start:prepare:files`, or accepting the
OSS 404. **None of those is needed.** Traced end to end:

- `dev/scripts/generate-modules.mjs:172` reads `LANGWATCH_BUILD_TIER` from the
  process environment and widens `tiers` to `["core","enterprise"]`.
- `start:prepare:files` (root `package.json:54`) runs `generate:modules`.
- apidiff runs `pnpm run start:prepare:files` on each side with
  `havenEnv(state.environ(), slug)`, and `havenrun.Env`
  (`tools/havenrun/havenrun.go:110`) inherits **everything** except
  `ManagedEnvKeys` - `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`,
  `REDIS_DB_INDEX`, `LANGWATCH_SLUG` - plus apidiff's one extra,
  `LANGWATCH_INSTANCE_ADMIN_API_KEY`.

`LANGWATCH_BUILD_TIER` is in none of those lists, so it passes straight through.
Measuring the enterprise build is:

```bash
LANGWATCH_BUILD_TIER=enterprise <the apidiff invocation>
```

No ADR amendment, no committed enterprise-tier generated list, no licensing call.
ADR-144 §6 says enterprise entries are emitted only in the enterprise build; this
measures the enterprise build, which is precisely what §6 describes.

Verified on today's tree, in process, writing nothing:

```
enterprise server modules: 49 (core: 44)
governanceServer present: true   scimServer present: true
governance: []   scim: ["prisma"]
```

**Report it honestly when it passes**: what reaches parity is the *enterprise*
build. The OSS build deliberately serves less, and the two-image split the user
asked for is the follow-up that makes that deliberate rather than incidental.

### Then

1. Collect `gov-rest-serves-25`; run the package suite and `typecheck:one`
   yourself before committing.
2. `LANGWATCH_BUILD_TIER=enterprise` apidiff run; expect the 25 to clear.
3. Follow-ups, in the user's stated order of preference: the two-image split
   (OSS and enterprise), then option A, collapsing the four
   `moduleApi("governance")` tokens into one.

**Known and deferred:** `@langwatch/infrastructure` is still not a dependency of
the governance server package. Adding it regenerates the lockfile, which absorbs
every other session's uncommitted `package.json` edits, and three peer sessions
are live in this checkout. It is not needed for the 25 - the app reads no process
member - so it waits for the lane that genuinely imports it.
