# Braids end-to-end pass (#9682), live stack 2ab28730, main 36a98897e77

Run 2026-11-18, 11:00 to 11:35 CET. Evidence files sit beside this file.

## Read this first: the stack was degraded

- The machine ran at load 25 to 34 on 11 cores with memory pressure "red". ClickHouse is capped at 1.35 GiB (`max_server_memory_usage`, "no OS ceiling") and refused trace, preview and activity reads with `memory limit exceeded` for the whole run.
- The authz grant projection lagged by 2 to 10 minutes. Every write that waits for it (`apiKey.create`, `authz.createBraid`, `authz.changeBraid`) answered **503 `authz_grant_not_confirmed`**. Braids landed later anyway. API keys did not: a failed `apiKey.create` revokes the key, so **no ingest key could be minted**.
- The haven browser was killed by its memory governor three times, and the backend reloaded twice in the middle of an action.
- My mistake: `haven db seed --json` started a second seed run (I meant it as a listing). I stopped it after 11 minutes (task `byd2qaif4`), so the extra seed data is partial. It added to the load.
- Result: no OTLP could be sent to the owner or reader projects. Everything that needs braided spans in a reader trace is **BLOCKED**: reader trace view, span detail, large bodies, windows, chaining, signed calls, and live probes (a), (b) and (d).

## Setup I made (test data, not product code)

| What | How |
|---|---|
| s1-enterprise-1 on Enterprise | insert `Subscription` `qa_braids_sub_ent1` (ENTERPRISE, ACTIVE). Set to CANCELLED at the end, so the org is back on Free |
| `release_braids` per organisation | `FeatureFlag.rules`: `[{match:{organizationId:<org1>},enabled:true}]`, later org2 too. Takes effect at once, so **a per-organisation rule works locally** |
| Project names | platform-1 is now `specialist-agents` (owner), platform-2 is `orchestrator` (reader), platform-3 has a 70-character name. Team `research` (`qa_team_research`) now holds platform-4 |
| Personas u3 to u7 | inserted `RoleBinding`, `Grant` (`qa_g_*`), CustomRole `qa_role_braider` and OrganizationUser=MEMBER. **These do not work**: membership comes from the event-sourced ledger, so u3 lands on `/onboarding/welcome` (2-01) and u3 to u13 show as "Waiting for a seat". The seeded org admin u1 and team member u2 were used instead |

Cleanup for whoever continues: delete `Grant` `qa_g_%`, `RoleBinding` `qa_rb_%`, `CustomRole` `qa_role_braider`, `Team` `qa_team_research` (move platform-4 back to `local_team_000000DRbAKDN1J2egqSbioXnKoUc`), the `release_braids` FeatureFlag row, the subscription row and the project renames. The 5 braids made by probes are still live in org1.

## Story 1: Organisation admin on Enterprise

As an organisation admin on Enterprise, I want to find Braids, keep braids to organisation admins and see every braid in the organisation, so that I control which project data crosses project lines.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Settings entry "Braids" with the flag on | PASS | 1-01 | Under the "Project" group |
| Project Braids page: empty state, Enterprise badge, switcher, docs link, "All braids in <org>" | PASS | 1-01 | |
| Organisation Braids page: "Who may braid" switch, empty list | PASS | 1-02 | |
| Organisation list shows every braid with from, into, condition, window | PASS | 1-03 | Shows the duplicate braids from defect D1 with nothing that marks them as duplicates |
| Turn on "Keep braids to organisation admins" | BLOCKED | none | The click caused a backend reload and the page moved to project home. Tried twice |
| Team admin refused once the policy is on | BLOCKED | none | No working team-admin persona |
| Dark mode | PASS | 6-04 (upsell) | |

## Story 2: Owner-project admin (specialist agents)

As an admin of the specialist-agents project, I want to braid my spans into the orchestrator project under a condition, check what the reader will see and change or remove the braid, so that the orchestrator team can follow its calls into my agents and see nothing else.

u1 (org admin) stood in for this persona. A project-only admin could not be created (see setup).

| Check | Result | Evidence | Note |
|---|---|---|---|
| Create a braid with a condition | PASS (late) | 2-02, 2-03 | 503 `authz_grant_not_confirmed`, then the braid landed about 2 minutes later (D2) |
| Picker (`listBraidTargets`): own project `this_project`, readable projects listed, other organisation's project left out | PASS | 2-03 | |
| Unsupported condition (`or`, numeric `>`) refused with construct, position and fix | PASS | 2-03 | `meta.construct`, `meta.at`, `meta.fix` are present |
| Too-large condition (20 kB, 60 comparisons) refused `braid_condition_too_large` | PASS | 2-03 | Message: "more than 1000 characters" |
| Live check of a broken condition (`attributes[`) | PASS | 2-03 | "The condition cannot hold an unclosed [. Complete the condition, for example…" |
| Condition with quotes, parentheses and an SQL-like payload in the key and value | PASS (accepted as literal) | 2-03, 1-03 | Compiled and saved. The SQL binding was not checked live |
| Self-braid refused `braid_into_itself` | PASS | 2-03 | |
| End date in the past refused `grant_expiry_in_past` | PASS | 2-03 | |
| Identical braid refused `braid_already_exists` | **FAIL** | 2-03, 1-03 | See D1 |
| Second braid on the same pair | PASS | 1-03 | |
| Edit replaces the braid (`replacesGrantId`, old one revoked `braid_changed`) | PASS (late) | 2-03 | 503 again, then landed |
| Invalid edit writes nothing | PASS | 2-03 | 422 `braid_condition_unsupported` |
| No-op edit saves nothing | BLOCKED | none | My probe changed `fromMs`, so it was not a no-op |
| Preview counts | **FAIL (env)** | 2-03 | 500 "An unknown error occurred". The cause is the ClickHouse memory limit (D5) |
| People count (`countProjectTraceViewers`) | PASS | 2-03 | `{count:2, exact:true}` |
| Test a trace, autocomplete in the UI, dialog walk | BLOCKED | none | The dialog click hit a backend reload, then the browser was killed |
| Remove from the owner side | BLOCKED | none | Kept the braids for the downgrade check |

## Story 3: Reader-project developer (orchestrator)

As a developer in the orchestrator project, I want braided specialist spans in my traces, labelled with where they came from, so that I can debug a whole call without access to the specialists project.

| Check | Result | Evidence | Note |
|---|---|---|---|
| A member lists braids into their project | PASS | 3-01, 5-01 | |
| A member is offered no "New braid" | PASS | 3-01 | |
| A member is refused change and remove | PASS | 5-01 | 403 `permission_denied` |
| "Braided from <project>" spans, span detail, large body, non-matching and out-of-window spans hidden, removal visible within 30 s | BLOCKED | none | No ingest key could be minted (D2 root cause) |
| "Last 24 hours" column | **FAIL (UX)** | 3-01 | Stuck on "Counting spans" with no error state (D4) |

## Story 4: Compliance officer, signed calls

As a compliance officer, I want braids that show only calls the orchestrator signed, with keys I can revoke and a full audit trail, so that a project cannot fake its way into another project's traces.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Signing keys section and empty state | PASS | 4-01 | |
| Member refused list and create with `permission_denied`; `projectSigning` answers | PASS | 5-01 | |
| Create, revoke, signed/unsigned/forged/replayed spans, audit entries | BLOCKED | none | Ingest blocked. Signing was done in the browser with WebCrypto, matching the SDK v1 wire format (`.claude/tmp/braids-qa/lib.js`), but never sent |
| Probe (b), one key lookup per random kid | Static only | none | See D6 |

## Story 5: Member, team admin outside their team, custom role

As a member, a team admin outside their team, or a holder of a custom role, I want clear refusals when I try to manage braids I have no right to, so that I know what is allowed and who to ask.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Member: create, change, remove, picker, set policy, organisation list, signing keys list and create all refused | PASS | 5-01 | All 403 `permission_denied` |
| IDOR: remove or change a braid via a project it does not touch | PASS | 2-03 | 404 `braid_not_on_project` |
| Remove an unknown braid id | PASS | 2-03 | 404 `braid_not_on_project` |
| Cross-organisation owner or reader | PASS | 2-03 | 403 `permission_denied` with `denialReason: no-membership` |
| Preview or attribute keys for another organisation's project | PASS | 2-03 | 403 |
| Team admin outside the team, custom role `braids:manage` | BLOCKED | 2-01 | Persona setup did not take (see setup) |
| Refusal copy says what to fix | **FAIL (UX)** | 5-01 | The tRPC message is the bare code `permission_denied`. Whether the UI words it was not reached |

## Story 6: Below Enterprise, and release_braids off

As an admin of an organisation below Enterprise, or one where Braids is not released, I want Braids to be absent or clearly upsold, and braids I already have to be kept, so that nothing changes under me.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Flag off: project Braids page answers not-found | PASS | 6-01 | |
| Flag off: organisation Braids page answers not-found | PASS | 6-02 | |
| Flag off: no settings entry | PASS | 6-01 | A snapshot grep for "Braids" found nothing |
| Flag off: management procedures refuse `braids_not_enabled` | PASS | 6-05.txt | `listBraids`, `getBraidsPolicy`, `listOrganizationBraids`, `listBraidTargets`, `countProjectTraceViewers`, `setBraidsPolicy`, `createBraid`, `signingKeys.list`, `signingKeys.create` |
| Flag off: helper reads refuse | **FAIL** | 6-04.txt, 6-05.txt | See D3 (probe c) |
| The flag is decided per organisation | PASS | 6-01, 1-01 | Org1 on, org2 off at the same moment |
| Below Enterprise: upsell page | PASS | 6-03, 6-04 | |
| After leaving Enterprise: "Braids are paused", "Your 5 braids are kept", Paused per row, create refused `enterprise_plan_required` | PASS | 6-05, 6-06.txt | |
| Remove still works with the flag off; existing braids still apply to reads | BLOCKED | none | Needs ingest |

## Branding

| Check | Result | Evidence | Note |
|---|---|---|---|
| Mark in the header and sidebar | PASS | 1-01 | |
| Empty state against the brand kit | **FAIL (brand)** | 1-01 vs B-01 | See D7 |
| Upsell art, light and dark | PASS | 6-03, 6-04 | |

## Defects, by severity

**D1, Medium: duplicate braids get through while the projection lags.** `braid_already_exists` is not enforced against writes still in flight.
- Steps: as u1, `createBraid` P1 to P2 with `where = attributes["orchestrator"] == "web"` and from T. Within seconds, `changeBraid` another live braid on the same pair to the same terms.
- Expected: the second write is refused `braid_already_exists`.
- Actual: both answered 503, and both landed as live grants with identical owner, reader, where and from: `rolebinding_000000DRbE4X2n6QHawvzBYrd2c6w` and `rolebinding_000000DRbE9OylMaHW9fLJyAFpnqj`.
- The uniqueness check reads the projection, not the ledger or the braid lock. Start at `modules/authz/process/src/services/authz-braid.service.ts` and `repositories/prisma/prisma.authz-braid-lock.repository.ts`.
- Evidence: 2-03-edge-cases-api.txt, 1-03, and the `Grant` rows quoted here.

**D2, Medium (UX and reliability): create and change answer 503 "Your access change is still processing. Refresh to check its status before trying again." and the braid lands later anyway.**
- An admin who retries makes a duplicate (see D1). For API keys it is worse: the key is revoked and the token is lost. This blocked all ingest in this run.
- The message gives no way to tell whether the braid exists.
- Code: `modules/authz/contract/src/authz.errors.ts:286-298`, `modules/authz/process/src/eventing/authz-grant.store.ts:1216-1249`.
- Evidence: 2-02, 2-03.

**D3, Low to Medium: the `release_braids` gate does not cover the braid helper reads (probe c).**
- With the flag off, `traces.braidAttributeKeys` and `traces.braidActivity` answer 200 on Free and on Enterprise.
- With the flag off on Enterprise, `traces.braidPreview` and `traces.braidTestTrace` also answer 200. `braidPreview` returned counts: `none:5, total:5`.
- Expected: `braids_not_enabled`, as for every other braid procedure (spec braids-release-flag.feature:47 says every braid management procedure).
- Also, `braidAttributeKeys` and `braidActivity` have no `withEntitlement`, so they answer below Enterprise too.
- Code: `modules/trace/process/src/transport/traces.trpc.ts:666-707`.
- Evidence: 6-04-flag-off-free-api-probes.txt, 6-05-flag-off-enterprise-api-probes.txt.

**D4, Low (UX): the "Last 24 hours" column stays on "Counting spans" when `braidActivity` fails.**
- With a 500 behind it, the column shows a loading state forever. It needs an error state.
- Evidence: 3-01, 1-01 owner list.

**D5, Low: preview and activity failures show "An unknown error occurred".**
- The cause is a known, retryable overload (ClickHouse memory limit), which the error rules say should be named.
- Evidence: 2-03, 5-01.

**D6, Low to Medium (static, probe b): one Postgres lookup per span for each random signature kid, and random kids can flush the cache.**
- `BraidSignatureVerificationService.#lookup` keys the cache by organisation and kid, with a bound of 10,000 entries. A sender that varies the kid on every span causes one `findCredentials` query per span, and can evict the real keys' cached entries.
- There is no per-organisation limit or negative-lookup throttle.
- Code: `modules/api-key/process/src/services/braid-signature-verification.service.ts:29,130-155`.
- Not measured live because ingest was blocked.

**D7, Low (brand): the empty-state art differs from the brand kit's.**
- The kit (B-01) uses dotted "not yet braided" strands, square two-letter project badges, orange/blue/green and a "+" target.
- The app (1-01) uses solid strands, round one-letter avatars, a purple strand and filled bars. The kit README says purple belongs to the old website palette.

**D8, Low (UX): the organisation Braids page highlights "Braids" under the sidebar's "Project" group**, though the page is organisation-wide. Evidence: 1-02.

**D9, Low (UX): duplicate braids look identical in both lists.** Nothing hints that two rows are the same, and nothing offers to remove one. Evidence: 1-03, 6-05.

## Not reached

These need a working ingest key, which D2 blocked under this load: probes (a) the reader injecting an owner-only trace id, (b) live, and (d) `spanLangwatchSignals`; chaining A to B to C; data windows; audit log entries; Python and Go signers; 500-project picker cap; concurrent create; narrow viewport.

A quieter machine (or a raised ClickHouse memory cap) should unblock them. The OTLP and signing helpers are ready in `.claude/tmp/braids-qa/lib.js`.
