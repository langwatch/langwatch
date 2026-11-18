# Braids end-to-end pass, run 2 (#9682), live stack 2ab28730, main 36a98897e77

Run 2026-11-18, 11:33 to 12:00 CET. Evidence files are the `r2-*` files beside this file. Run 1 files are untouched.

## Read this first: the stack

- Load fell from 29 to 9 during the run, but ClickHouse stayed at its 1.35 GiB cap, and some reads still failed with `memory limit exceeded` (500 "An unknown error occurred", D5 from run 1). This hit `traces.spanLangwatchSignals` and `traces.spansFull` on some calls.
- The haven browser was killed by its memory governor 3 times. Each kill lost the lane's session and local storage, including the in-browser signing secrets and API key tokens. That is why more API keys and signing keys exist than the steps need (see cleanup).
- The stack went down once (launcher time limit) at about 11:46 and the coordinator restarted it. Calls that failed during the outage were retried, not recorded.
- Projection lag now: `apiKey.create` took 298 ms, then 10.5 s (503), then 3.6 s; `authz.createBraid` took 10.2 s (503) at 11:36, then 280 ms from 11:41 onwards. `authz.createGrant` took 0.3 to 3.4 s. So the lag is mostly caught up, with spikes.

## Setup made in run 2 (test data, not product code)

| What | How |
|---|---|
| Org1 back on Enterprise | `Subscription` `qa_braids_sub_ent1` set ACTIVE, and `maxMembers` set to 50 |
| Ingest keys | `apiKey.create` through the product as u1 (s1-enterprise-1.u1, org admin). Worked |
| Personas | Approved the open seat requests of u8 to u11 (`seatRequest.approve`, "enabled"), then granted through `authz.createGrant`: u8 project admin of specialist-agents (P1); u9 team admin of `research` (holds platform-4, P4); u10 custom role "R2 braid steward" (`project:view`, `traces:view`, `braids:manage`, made with `role.create`) bound on P1 only; u11 viewer of orchestrator (P2). Later u8, u9 and u10 also got viewer on P2, because a braid needs `traces:view` at the reader |
| Why u3 to u7 failed in run 1 | They were inserted straight into Postgres and hold no ledger membership. `createGrant` for u3 answers 500 (D14) |

## Story 1: Organisation admin on Enterprise

| Check | Result | Evidence | Note |
|---|---|---|---|
| Turn on "Keep braids to organisation admins" (API, as u1) | PASS | r2-1-01 | `setBraidsPolicy` 200, `getBraidsPolicy` shows it for every role |
| Project admin (u8) refused create, picker | PASS | r2-1-01 | 403 `permission_denied`, `braids:manage`, `no-grant` |
| Team admin (u9) refused create, picker | PASS | r2-1-01 | Same |
| Custom role holder (u10) refused create, picker | PASS | r2-1-01 | Same |
| UI tells a project admin why | PASS | r2-1-02 | Banner "Your organisation's admins manage braids … only they can create, change or remove them" with "Ask an admin" |
| API refusal says why | **FAIL (UX)** | r2-1-01 | Bare `permission_denied` / `no-grant`, nothing names the policy (D12) |
| Toggle in the UI | BLOCKED | none | Done by API; the browser was killed before the UI toggle |

## Story 2: Owner-project admin (specialist agents)

| Check | Result | Evidence | Note |
|---|---|---|---|
| Project-only admin (u8) creates P1 to P2 | PASS | r2-5-03 | Refused `traces:view` at the reader until u8 could view P2, as designed |
| Concurrent create, identical terms, projection caught up | PASS | r2-2-01 | 3 parallel: one 200, two 409 `braid_already_exists`; a fourth sequential 409; one live braid. **D1 does not reproduce once the projection is caught up** |
| No-op edit | PASS | r2-2-02 | `changeBraid` with the same terms answers 200 with the same `braidId`; nothing replaced |
| Remove from the reader side | PASS | r2-3-08 | `removeBraid` via P2: 200 in 25 ms |
| Remove from the owner side | PASS | r2-4-04, r2-sec-a | The no-condition braid removed via P1 |
| Dialog: picker | PASS | r2-2-03 | orchestrator, the 70-character project, platform-4; own project disabled "This project" |
| Dialog: preview counts, people count, overlap | PASS | r2-2-03 | "8 / 17 traces get spans", "6 people in orchestrator", "Adds 12 spans that the 6 other braids don't show" |
| Dialog: "Only signed calls" switch | PASS (present) | r2-2-03 | Not toggled; the browser was killed |
| Dialog: autocomplete, live check, Test a trace | BLOCKED | none | The condition editor (`native-edit-context`) took no typed input from `haven browser type`; the browser was then killed |
| Empty condition warns about what it shares | **FAIL (UX)** | r2-2-03 | "Left empty, all of them" only (D10) |

## Story 3: Reader-project developer (orchestrator), as viewer u11

| Check | Result | Evidence | Note |
|---|---|---|---|
| "Braided from specialist-agents" badge in the header | PASS | r2-3-04 | |
| Braided spans badged per span in the waterfall | PASS | r2-3-06 | |
| Non-matching span (`orchestrator=cli`) hidden | PASS | r2-3-02, r2-3-06 | |
| Out-of-window span (2 h before `from`) hidden | PASS | r2-3-02 | Header duration 379.9 s covers only the shown spans; the hidden span's time does not leak |
| Owner-only trace not listed | PASS | r2-3-05 | |
| Span detail of a braided span | PASS | r2-3-07 | Shows "matches one of" with the braid conditions |
| Large body (300 kB output) | PASS (redacted) | r2-3-07 | Stored offloaded; shown as `[REDACTED] (visible to members of this project)` under the owner's policy, as ADR-201 says. The wording is misleading (D13) |
| Remove the braid: spans gone | PASS | r2-3-08, r2-3-09 | Gone at the first poll, 101 ms after removal |

## Story 4: Compliance officer, signed calls

Braid P1 to P2 with `Verified("orchestrator")`. Signatures made in the browser (`lib.js`), which reproduces the pinned vector the TS, Python and Go SDK tests share (`r2-vector.mjs` output equals `braidPinnedSig`).

| Check | Result | Evidence | Note |
|---|---|---|---|
| Create signing keys (P2 and a third project P3) | PASS | r2-4-01 | |
| Signed span shown | PASS | r2-4-02, r2-4-03 | Stored mark `langwatch.reserved.verified.orchestrator = <P2>` |
| Unsigned, forged secret, changed value, replayed into another trace: hidden | PASS | r2-4-02 | No mark stored |
| Third project's key: hidden | PASS | r2-4-02 | Mark names P3, braid does not match |
| Client-sent `langwatch.reserved.verified*`: stripped | PASS | r2-4-01 | |
| Revoke: a span signed 65 s later is not marked | PASS | r2-4-04 | A span signed before revocation keeps its mark and stays braided |
| Audit entries | PASS | SQL | `authz.createBraid`, `changeBraid`, `removeBraid`, `setBraidsPolicy`, `authz.organization_policy.braids_changed`, `signingKeys.create/revoke`, `braided_spans.viewed` (one row per actor, reader, owner per 5 minutes, by design) |
| Real TS, Python and Go SDK runs | BLOCKED | none | Python has no OpenTelemetry installed; the secret cannot leave the browser under the agent rules. Wire parity shown by the pinned vector instead |

## Story 5: Team admin outside their team, custom role

| Check | Result | Evidence | Note |
|---|---|---|---|
| Personas through the product | PASS | r2-5-01 | Seat approval plus `createGrant` |
| Team admin creates from a project of their team (P4 to P2) | PASS | r2-5-03 | |
| Team admin refused outside their team (P1) | PASS | r2-5-02, r2-5-03 | 403 `braids:manage` |
| Custom role braids only where bound (P1 yes, P4 no) | PASS | r2-5-03 | |
| Picker per persona | PASS | r2-5-03 | |

## Story 6: release_braids off for org1

| Check | Result | Evidence | Note |
|---|---|---|---|
| Remove still works | PASS | r2-6-01 | 200 |
| Existing braids still apply to reads | PASS | r2-6-01 | The signed span still shows to u11 |
| Create refused `braids_not_enabled` | PASS | r2-6-01 | |
| An admin can find what to remove | **FAIL (UX)** | r2-6-01 | `listBraids` 403 and both pages not-found (D15) |

The flag was turned back on for both organisations afterwards.

## Edge cases

| Check | Result | Evidence | Note |
|---|---|---|---|
| Chaining A to B to C does not chain | PASS | r2-E-01 | Reader P2 sees B only; P1 sees A |
| `from` before creation | PASS | r2-sec-a-2 | A braid from 3 h ago braided a span sent 15 min before creation |
| Long project name in the picker | PASS | r2-2-03 | |
| Many braids (7 into orchestrator) | PASS | r2-1-02 | List stays readable |
| Narrow viewport 390 px | BLOCKED | none | `haven browser` has no viewport verb, and MCP browsers are refused here |

## Security probes

**(a) Reader injects an owner-only trace id.** Owner trace T3 (`specialist.secret`, `orchestrator=cli`, input "OWNER SECRET T3"); the reader sent one span with that trace id.
- With only a `Verified("orchestrator")` braid (and condition braids that do not match): nothing of the owner comes back (r2-sec-a-1).
- With a no-condition braid: `spanTree` and `spansFull` return the owner span: name `specialist.secret`, span id, start, duration, status, and every custom attribute (`orchestrator: cli`, `qa.case: secret-owner`). `langwatch.input` is `[REDACTED] (visible to members of this project)`. `braid.matchedConditions` is empty (r2-sec-a-2). ADR-201 line 172 says an empty condition braids every owner span that shares a trace id with the reader, so this is by design, but the reader chooses the trace id. See D10.

**(b) 200 spans with random signature kids:** `SigningKey` `idx_scan` went from 18 to 218, so exactly one Postgres lookup per span. All 4 OTLP requests answered 200, with no throttling. Run 1's D6 is confirmed live (r2-sec-b).

**(d) `spanLangwatchSignals` on a braided trace as the reader:** 200 `[]` (no owner span carried signals, so whether owner rows come back with owner protections is **inconclusive**). The client-supplied `tenantId` cannot hop to the owner: `tenantId=<owner>` answers 404 `trace_not_found` on both a braided and an owner-only trace; `projectId=<owner>` answers 403 (r2-sec-d). Under memory pressure it answered 500 "An unknown error occurred" (D5).

## Defects, ranked (continuing from D9)

**D10, Medium (design and UX): a braid with no condition gives the reader any owner trace whose id it knows.**
- Steps: braid P1 to P2 with an empty condition. As P2, send one span with the trace id of a P1-only trace. Read it as a P2 viewer.
- Expected: either refused, or the dialog warns that the reader picks the trace ids and suggests "Only signed calls".
- Actual: the owner span's name, timing and all custom attributes come back; only `langwatch.*` content is redacted. The dialog says "Left empty, all of them."
- ADR-201:172-173; dialog r2-2-03; data r2-sec-a-2.

**D11, Medium (confirms D6 live): one Postgres lookup per random signature kid, no throttle.** 200 spans gave 200 `SigningKey` index scans. `modules/api-key/process/src/services/braid-signature-verification.service.ts:130-155`. Evidence r2-sec-b.

**D12, Low (UX): a refusal under "Keep braids to organisation admins" does not name the policy.** The API answers `permission_denied`, `braids:manage`, `denialReason: no-grant` for a project admin who held the right a moment ago. The UI banner explains it, but API and CLI callers get no hint. Evidence r2-1-01 vs r2-1-02.

**D13, Low (UX): redaction text on a braided span says "visible to members of this project".** In the reader's trace, "this project" reads as orchestrator; it means specialist-agents. It should name the owner. Evidence r2-3-07.

**D14, Low: `authz.createGrant` answers 500 "An unknown error occurred" for a user with no ledger membership.** `BindingMissingError: role binding no longer exists` at `modules/authz/process/src/eventing/authz-grant.store.ts:374` (`captureMembershipStamps`). The state came from run 1's direct inserts, but the error should be a coded 4xx. Trace `76108158d564b96e8a85925363cba878`.

**D15, Low (UX): with release_braids off, braids keep applying but nobody can list them.** Spec braids-release-flag.feature:54 keeps remove working, but `listBraids` is refused and both pages are not-found, so an admin cannot find a braid id to remove. Evidence r2-6-01.

**D2 still reproduces under lag:** `createBraid` 503 after 10.2 s at 11:36, and the braid landed anyway (`rolebinding_000000DRbFBGRfSn2PdwPYPa60lHK`); `apiKey.create` 503 after 10.5 s.

**Observation (not ranked):** the first reader span (P2, 11:36, accepted 200) was never stored; the same send 6 minutes later landed in 10 s. The worker was draining a seed backlog under ClickHouse memory errors, so this may be the environment.

## Cleanup list (everything run 2 created)

- Subscription `qa_braids_sub_ent1`: now ACTIVE with `maxMembers=50` (run 1 left it CANCELLED).
- FeatureFlag `release_braids`: rules back to both s1-enterprise orgs.
- Braids policy for org1: **"Keep braids to organisation admins" is ON** (`setBraidsPolicy` true).
- Seat approvals: u8, u9, u10, u11 enabled in org1.
- Grants: u8 admin on P1 `rolebinding_000000DRbFWBOSM7RRar9JniEpPo2`; u9 admin on team `qa_team_research` `rolebinding_000000DRbFWVyomaIz5JbbHcSkJYi`; u10 custom on P1 `rolebinding_000000DRbFWVyomaIz5JbbHcSkJYv`; u11 viewer on P2 `rolebinding_000000DRbFWcqGvPGAFT5h6vCic8v`; viewer on P2 for u8 `…DRbFjF81964guuQPRNjamoK`, u9 `…DRbFjZiNZYwEPMsgvHxVgZ8`, u10 `…DRbFjgZpiNtPZWMmkahTz9M`.
- Custom role `customrole_000000DRbFWBOSM7RRar9JniEpPnt` "R2 braid steward".
- Live braids: P1 to P2 `qa.persona` u8-off2 `…DRbFkSc0i8ZfialRXhtI5FH`, u10-off2 `…DRbFkZTSqxWqskFXN0dGNpV`, u8-on `…DRbFlSN5zXAIBy8HzQZ2mVh`, u10-on `…DRbFlZEY8M7TM7cNojJ1561`; P4 to P2 u9-off2 `…DRbFkZTSqxWqskFXN0dGNpQ`, u9-on `…DRbFlZEY8M7TM7cNojJ155o`; P1 to P2 `Verified("orchestrator")` `…DRbGQxgTZPB4JmKSS9ncg6c`; chain P3 to P1 `…DRbHG60BJ6AFySZsjoMxAHp` and P1 to P2 `…DRbHG60BJ6AFySZsjoMxAHs`. Run 1's 5 braids and run 2's first, no-condition and race braids are removed.
- API keys (not revoked): "r2 specialist", "r2 orchestrator b", "r2 specialist c", "r2 orchestrator c", "braids-qa nKoUl" (10:36, 10:42 UTC), "braids-qa nKoUj" (10:36 UTC). "r2 orchestrator" was revoked by its failed create.
- Signing keys: "r2 third signer" on P3 (active); "r2 orchestrator signer" and "r2 revoke test" on P2 (revoked).
- ClickHouse spans in P1, P2 and P3 for traces T1 `8c0130089dc1f25c886a1d61320528fb`, T2 `7a8b02d3…`, T3 `66fe0536…`, T4 `e046a623…`, T5 `1822190a…`, T6 `03b92a98…`, T7 `112e1941…`, T8 `3804d128…`, probe (b) `48563fa4…` (200 spans), reader-only `abcdef0123456789abcdef0123456789`.
- Scripts in `.claude/tmp/braids-qa/`: `r2-*.js`, `r2-vector.mjs`, `r2summ.py`, `ch.sh` (reads the ClickHouse URL from `haven db url`, prints nothing secret).
