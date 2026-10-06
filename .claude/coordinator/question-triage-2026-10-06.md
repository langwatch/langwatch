# Question triage, 2026-10-06 (night)

Every open question Alex has not answered, checked against `.claude/coordinator/rulings-2026-10-05.md`
(cited `rulings:<line>`), `dev/docs/ARCHITECTURE.md`, `dev/docs/adr/`, the four plans and the git log
since 2026-10-05 (tip `53706b1dba`). Parity facts come from two runs of
`check:feature-parity --json` tonight (96, then 86 unbound after the three night bind lanes).
"Main bound it" means a test on `origin/main` (`ab5d6a1597`) carries the scenario's exact title.

Buckets: **A** answered by a ruling or the record; **B** moot (code or a later decision);
**C** default taken (or, marked _proposed_, the default a ruling's principle implies), needs only
Alex's yes; **D** a real decision; **E** cannot be asked usefully yet.

Inputs triaged: `held-questions.md` "## Open" (all groups); the numbered ids in
`questions-2026-10-06.md` that no ruling cites by number (85 entries: the ranges 3-4, 5-8 and 9-13
count as one each); every scenario still unbound tonight (82, which replaces the "91 bind round 2 rows"
and absorbs `bind-identity-access-night.md`, `bind-langy-lwql-night.md` and `bind-rest-night.md`);
and leftover parts of ids a ruling cites only in part (9).

## 1. Counts

| Group                                   | Total |  A |  B |   C |  D |  E |
| --------------------------------------- | ----: | -: | -: | --: | -: | -: |
| Upgrade UI (Q-U5 to Q-U11)              |     7 |  0 |  1 |   3 |  3 |  0 |
| Legacy error body (LE-1 to LE-3)        |     3 |  1 |  0 |   2 |  0 |  0 |
| Migrations blitz (held lines 45-91)     |    47 |  0 |  5 |  38 |  3 |  1 |
| SDK paths (SDK-1, U2-*, Q-U2, S4)       |     6 |  1 |  0 |   1 |  3 |  1 |
| Event upcaster and mig-ci               |    11 |  0 |  0 |  11 |  0 |  0 |
| Peer cut T1                             |     1 |  0 |  0 |   1 |  0 |  0 |
| apidiff (Q29, dataset records)          |     2 |  0 |  0 |   2 |  0 |  0 |
| Main #8484 port (P8484-R1 to R3)        |     3 |  0 |  0 |   0 |  3 |  0 |
| apidiff on 087ec10 (AD-1, AD-2, CH-1)   |     3 |  0 |  0 |   2 |  1 |  0 |
| Older numbered questions (uncited ids)  |    85 | 21 | 22 |  24 | 16 |  2 |
| Unbound scenarios (bind rows, recount)  |    82 | 23 |  0 |  16 | 37 |  6 |
| Leftover parts of partly cited ids      |     9 |  0 |  4 |   2 |  1 |  2 |
| **All**                                 |   259 | 46 | 32 | 102 | 67 | 12 |

The 67 D entries collapse into **28 questions in 7 rounds** (section 4): the 37 bind rows and five
older ids that are the same rows go into four batch questions.

Nothing held blocks the peer-cycle gate: the cuts are ruled (rulings:273-284, :328) and the
remaining 205 `peer-cycles` findings are lane work. The parity gate is blocked by round 1 and round 2.

## 2. A and B, with citations

### 2.1 A: answered

Held groups:

- **LE-2** masked 5xx. rulings:17: "undeclared server errors stay masked"; rulings:21: "A class declaring `fault: "customer"` at 5xx keeps its body". Keep the mask.
- **Q-U2** (held line 99, "release upgrade" copy). rulings:347: "Q-U2 page "Upgrades" under Ops, copy says "release upgrade" where ambiguous, CLI stays `upgrade`".

Older numbered:

- **5-8** four governance fixes. rulings:54: "Parity defects to fix, spec first: anomaly webhook secret redacted on read; seat count excludes deactivated users; a config-only Lambda rollout invalidates the cached function; the HTTP server drains open connections on shutdown."
- **16** CRON_API_KEY bearer map. rulings:226: "retire internalBearers' cron handle and CRON_API_KEY" (landed ff65b6a83f).
- **18** SSO termination plan read. rulings:194: "identity's getSetup returns an enterpriseRequired flag".
- **20** process supply. rulings:51: "the transport is skipped, not refused"; the shared-secret half is retired by rulings:226.
- **36** automation ceiling tier. rulings:128: "the runaway-ceiling notice from the worker offers the next plan tier (wire AutomationNextStepService)".
- **37** digest module. rulings:256: "digest.feature moves to planned: LEGACY_INERT with a reason, never built on main or here."
- **43** admin writes by input. rulings:189: "the platform-operator door gains an option that hides with 404 from non-staff and answers 403 to staff lacking the write permission".
- **48** device-flow key expiry. rulings:91: "No expiry default: minting requires an explicit expiry choice (including "never")".
- **69** Stripe seam. rulings:121: "Stripe becomes a billing channel with a memory twin; the composition scenario binds over the twin."
- **70** Instant Eval catalogue check. rulings:119: "Reported only once Stripe's catalogue holds the meter."
- **76** Lambda cache fingerprint. rulings:127: "fingerprint the function's config in the Lambda cache entry".
- **78** credential-arbitration:99. rulings:212: "(6) the record stands: /api/files and /api/user-avatar stay API-key routes ... reword the credential-arbitration rows."
- **86** agent App answer validation. rulings:129: "a malformed protocol output from a connected agent keeps the response without logging its content (no 500)".
- **103** metrics door. rulings:296: "an unconfigured metrics door stays 404 and boot names the missing token."
- **117** gateway tour. rulings:125: "Restore the gateway tour (tour actions registered, the key reveal recorded, tour targets on the gateway key screens)".
- **122** legacy key row. rulings:94: "No legacy key row (ADR-002)".
- **124** CLI login key and audit names. rulings:75: "A project login returns a project session, never the project's API key"; rulings:94: "audit actions apiKey.create / apiKey.revoke".
- **126** Instant Eval meter regression. rulings:119 (as 70).
- **150** rulings vs product (Trace 9, Auth 32). The rulings stand and the product follows: rulings:88 "Both tracked-event routes mount and refuse by name without a recorder"; rulings:81 "An unfinished account is adopted only by an address proof".
- **160** agent-cache key lifetime. rulings:208: "12-hour key, held 8 hours".
- **171** suites run page and pill. rulings:97: "Run Again stays on a standalone run page, which is built (scenario)"; "suites metrics pill shows average agent latency".

Bind rows (build the ruled behaviour or reword to the ruling, then bind):

- **tracked-event-validation:78**. rulings:88 (Trace 9) as above. Today `trackEventFromRequest` swallows the 503 and answers 200 (trace.app.ts:3355-3359); build the refusal. A, not D: Alex ruled "scenario"; Q150 only asked whether to revise.
- **api-keys-v2:122, :129, :135**. ARCHITECTURE.md:2049: "The legacy project key (`Project.apiKey`) is never minted or returned" and "Platform paths never hand the legacy key to an engine". Stop minting and returning it on create; reword :129/:135 to "no internal caller reads the legacy key".
- **plan-allowance-on-ingest-doors:37** ("a deployment that meters nothing"). rulings:323: "METER EVERYWHERE. Self-hosted meters too". Retire.
- **admin-catalog-editor:56, :101**. rulings:157 lists Q114 ("admin-catalog-editor:56/101 ... Reword to product?") as "product". Retire :56, reword :101 to the card's rows.
- **externalize-event-byte-content:713**. rulings:157 lists Q120 (":65/:713 are @deprecated") as product: "delete the ones describing a retired design."
- **suite-bugfixes-1956:44**. rulings:97: "Run Again stays on a standalone run page, which is built". Build the page and reword to it (the rest lane's "retire" goes against the ruling).
- **identifier-model:129**. rulings:230: "restore the provisional Identifier write at sign-up (ADR-135 decision 2)".
- **identity-storage-adapter:584, :660**. rulings:342: "reword the storage-adapter scenario to what the code does; build an OIDC test harness so the SSO callback scenario is proven end to end."
- **mfa-and-session-shape:524, :555**. rulings:205 restores "impersonation as {actor, subject} claims"; rulings:212 (4) builds it through new AuthApi operations.
- **sso-activation:622**. rulings:123: "The audit row is written for the attempt, before the ledger answers, and kept on refusal".
- **sso-onboarding-tiers:433**. rulings:118: "/settings/authentication stays behind sso:view; the scenario is rewritten." Take the night lane's rewording (read-only without sso:manage).
- **api-process-executable:102**. rulings:346: "/readyz 503 until then; liveness 200 once the process is up". Reword, build, bind.
- **api-process-metrics:65**. rulings:296: "restore Node default collectors (regression)". Not built yet (no `collectDefaultMetrics` in the tree).
- **api-process-trpc-record:22, :60**. rulings:227: "a process missing a module another installed module needs refuses to boot by name; rewrite the host-injection scenarios to that."
- **declarative-process-composition:31**. rulings:196: "delete withMembers, MemberSource and storesBackedMembers": the named-members design goes, so the scenario goes with it.
- **user-avatar-upload:90, :139**. rulings:212: "/api/files and /api/user-avatar stay API-key routes, the UI reads media through tRPC". Reword to the signed-URL read; retire :139.

### 2.2 B: moot

Held groups:

- **Q-U8** (upgrade UI line 32). Superseded by held line 56 (recommendation added, default taken); triaged there as C.
- **Blitz line 57** (Q-U5, Q-U10, Q-U11 defaults). Duplicate of the upgrade UI lines, triaged there.
- **Blitz line 73** (stale bound and interval, no default). Superseded by held line 89's default: `packages/upgrade/src/gate/serving-upgrade-gate.ts:19` `PRESENCE_TIMING = { staleAfterMs: 60_000, refreshEveryMs: 15_000 }`.
- **Blitz line 76** (serving gate data source, item stopped). Superseded by held line 84 (default (a) built).
- **Blitz line 77** (S3-RETRY, item stopped). Superseded by held line 86 (conservative default built).
- **Blitz line 83** (S3-NO-CLICKHOUSE, no recommendation). Superseded by held line 85 (default built).

Older numbered:

- **3-4** (invitations:117, api-process-trpc-record:60). Same rows as Q68; triaged there and in the bind rows.
- **9-13** (licensing 2, ops 2, authz 5). Tonight's parity run lists only org-access-cluster of the nine (carried in the bind rows); credential-arbitration is ruled (rulings:212), ops wording by rulings:87 ("Ops "three loops"").
- **15** month_counted trace field. Landed: `modules/entitlement/contract/src/usage.events.ts:32-33` `traces: z.number().int().nonnegative().optional()`.
- **19** SAML signing harness. Built: `packages/test-harness/src/saml-signer.ts` (helper ordered by rulings:126).
- **29** graph default size. Same item as held apidiff Q29 (counted there); 0517d1ebfc.
- **46**, **47** (licensing import scan, trace-read-service:42). Neither row is unbound tonight.
- **49** CI tsbuildinfo replay. CI now drops a restored dist for every changed package and its dependants (`.github/workflows/langwatch-app-ci.yml:512-523`).
- **59** 8 vs 9 tiles. `specs/ai-governance/personal-portal/default-catalog.feature:58,66` now say 9.
- **93** voice key. Superseded by Q115.
- **94** scenario snapshot optional fields. 4bb84c6908 "exempt the scenario version snapshot from the optional model fields, as main".
- **101** api-endpoint-authorization rows. Bound; passkeys:432 is carried in the bind rows.
- **102** declarative-process-composition `reads`. rulings:196 deletes the members seam (row in 2.1).
- **115** voice callerEnv. Product merges callerEnv and voice-agents-v1:373 is bound (`.claude/handoffs/apply-rulings-5.md` §12).
- **135** dead tooling specs. 4e7f8c1aae; rulings:257; none of its rows is unbound.
- **141** digest sub-questions. rulings:256 parks digest as LEGACY_INERT.
- **148** LWQL saved charts. The five langy-authoring rows were bound tonight (not in the second parity run); :270 is decided by rulings:158 (Q180, 403 accepted).
- **152** cycle-survey risks. (1) rulings:163; (2) rulings:338 (project facts carry the lineage); (3) rulings:217.
- **155** misspelled shared secret. The bearer map is retired (rulings:226, ff65b6a83f); the row is no longer unbound.
- **158** REST remediation fields. Ported in fa854f4699.
- **187** small rows. Each part is retired (rulings:257), ported, or carried elsewhere (Q188, bind rows).
- **194** team routes. Settled by door-team-target (the question says so).

Leftover parts:

- **Q154(3)** pepper, DATABASE_URL, REDIS_URL unset. ff65b6a83f "make store and pepper refusals boot-time scenarios".
- **Q166(3)** ApiKeyNotFoundError bind. legacy-rest-remediation:67 bound by bind3-product.
- **Q196(1), (3), (4)** trace-table rows. Not unbound tonight.
- **Q219(2)** spa-fallback traversal. Not unbound tonight.

## 3. C: one confirm-all question

Suggested AskUserQuestion item: header "Confirm all", question "Confirm the defaults below as taken (or proposed)?", options "Confirm all (Recommended)" / "Confirm all except the ids I name" / "Ask me per group".

Upgrade UI and legacy body:
- Q-U5 both rollback rules; Q-U10 no organization surface; Q-U11 required one-line step description (all built).
- LE-1 root `error` only on published statuses; LE-3 other legacy shapes left until apidiff names a break.

Migrations blitz (coordinator design; ADR-173, Proposed, adopts D1, D2, D8):
- D1 one model keyed by step id; D2 presence; D4 child target table; D5 `withUpgradeGate` preamble; D6 lock-heavy guard and `lock_timeout`; D7 four CI gates; D8 contract waits for the floor on cloud; D9 manifests in `packages/upgrade/releases/`; D10 first floor = newest release at merge (3.20.1 today); D11 refuse a goose number main used.
- Q-U8: `upgrade` registers declared steps; ops builds `UpgradeReader`; the record's "the runner belongs to ops" (ARCHITECTURE.md:1311) becomes "ops reads and requests; the framework runs".
- mig-declare: checkpoint shape `{ resumeFrom, save }`; upcasts declared with `.withUpcasts` as `upcast:<pipeline>:<type>`; per-step rules refuse at boot, list rules at collection.
- U1-a no eighth state (`no-upgrade-recorded`); U1-b an unfinished run reads Upgrading before the lease table; U1-c ISO strings and `UpgradeReadError` codes.
- mig-guard: the NEW_RULES_FROM marker; set-not-null has no escape hatch; _proposed_: the two-owner check runs as an enforcer policy (line 65) and the enforcer prints the table-to-owner map the stamp reads (line 68), both only if D3 stays (a).
- Ledger reads the database clock; fresh install plans `event-upcast` by its mode (harmless on an empty install).
- Presence: no `clock`; `oldWritersGoneFor` true with no live row; name kept; timings 15 s / 60 s.
- S3: bootstrap applies the Postgres schema first; image release = newest manifest; timings (lease 60 s, lock_timeout 10 s, 3 retries); a refused run is recorded failed; gate's own one-connection pool from `DATABASE_URL`; ClickHouse steps ignored only with no ClickHouse target; never auto-resolve a failed Prisma row; first install spawns `upgrade` once; system-migrations pass after `upgrade` in the prepare script.
- U3-a reuse `checkup_clickhouse_migrations_pending`, at most five ids; U3-b doctor runs `upgrade status`.

Upcaster, CI, SDK, apidiff:
- UP-1 kind `event-upcast` (the record already says so, ARCHITECTURE.md:1796); UP-2 id `upcast:<pipeline>:<type>`; _proposed_ UP-3 wired as Q-U8; _proposed_ UP-4 rewrite by re-inserting copies, originals deleted only at the floor; _proposed_ UP-5 a lint names drains older than one release (rulings:3, drift caught by lint).
- mig-ci D7a advisory until a green month; D7b fail only drift a PR adds; D7c warn on a base without the live suite; D7d the N-1 and floor smokes as built; D11 refuse a main goose number; stamp without owners until D3 lands.
- S4-TARGETS every ClickHouse target runs and a failed one fails the release (consistent with rulings:347 Q-U1 (a)).
- T1-D2-deps option (a); review `CodingAgentApi.readSessionGroupsForViewer` and the typed `TraceApi.readSessionGroups`.
- Q29 REST 1x1 as main, tRPC 4x3 (0517d1ebfc); dataset records gain an additive `dataset` summary (abe7da6705).
- AD-1 accept `agents.testRun/testTurn` -> `scenarios.testAgent*` as an internal rename (d9936d6739); AD-2 live fixtures run `upgrade` once (3f5394a2b5).

Older numbered:
- 53 _proposed_ platform-health:95 blank key: tag @unimplemented (main has no such test; rulings:159 rule).
- 54 `completeCode` keeps no userId (`modules/workflow/process/src/app/workflow.app.ts:1007`).
- 55 _proposed_ move the two credential scenarios into auth's spec.
- 62 _proposed_ accept the operator-resend and tiers binds as weak; reword sso-onboarding-tiers:85 to one lifecycle order.
- 68 _proposed_ delete the unreachable `OrganizationCapabilityUnavailableError` branches and invitations:123 (`organization.app.ts:516,580`; follows rulings:227).
- 75 _proposed_ leave the customer's own provider id in `routing_excluded_providers` (no credentials).
- 88 _proposed_ `offboardUser` stays on `AuthzLedgerReadRepository`, the repository the ruling named.
- 146 _proposed_ retire feature-package-boundaries:9 (haven owns the slot gate) and strict-feature-layout:92 (rule gone).
- 165 Langy retry: 3 attempts at 5, 10, 20 s (9859d1df33).
- 167 _proposed_ keep api-endpoint-authorization:216 (it is the live route sweep rulings:193 asked for); rewrite typed-permission-declarations:208 to what its tests prove.
- 168 small calls: "OKTA" uppercased; the SCIM group dialog copy; split the agent type-select row; break-glass counts live grants.
- 169 port main's stricter organization guard (refusals only); SAML rows in a live-api test; gateway tour via the existing lend.
- 172 _proposed_ reword cli-login-personal-guard:86 to "can view" and bind with an authz test.
- 173 no limiter on memory stacks.
- 188 workflow create dialog submits twice, as main.
- 191 authz package-boundary test cache scope (14ac832cf7).
- 195 queue the authz epoch test helper with the next authz touch.
- 197 project's narrow `ProjectStorageSettingsRepository` owns the s3 writes (option B).
- 199 live suite tier requires Redis; shared OTEL headers handle; assert the FK code, not prose.
- 201 _proposed_ keep main's team door behaviour (organization's `TeamNotFoundError`; team-only keys refused on their own team routes).
- 210 _proposed_ build `.withChannels`/`defineChannels` first (names stand, ARCHITECTURE.md:2796); convert `Pick<XService>` consumers to `*Api` then delete; real memory twins (§13).
- 214 _proposed_ `module-classes` ignores a file whose class is private; the trace-signal copy waits on 207 (trace tables).
- 217 _proposed_ reword azure-blob-workload-identity:344 to the task's own credentials; lazy shared backend as main; delete the unused staging classes; DATAPLANE_S3 is already ruled (rulings:205).
- 220 delete `BuiltInPullerRegistryService` and the uninstalled registry.

Bind rows (all _proposed_ unless noted):
- authz package-boundary:125 reword to "every process installs every module; api registers pipelines producer-only".
- github-branch-maintenance:90 tag @unimplemented (main has no test; rulings:159 rule).
- invitations:123 delete with the dead branch (= 68).
- platform-health:95 (= 53).
- feature-package-boundaries:9, strict-feature-layout:92 (= 146).
- ui-contract:314 reword to the per-module governance-filter tests and drop "CI fails".
- audit-log:83, :91, :177 take the night lane's rewordings (`bind-identity-access-night.md` §5); a coordinator lane adds the host-level test in packages/api for :83.
- fresh-clone-dev-setup:40 fix `.env.example` so its sentinels meet the 32-character minimum (main has no test).
- guided-onboarding-offer:39, :109 bind the personal and gateway homes; drop "governance" (no governance home exists).
- langy-trace-explorer-actions:220 port main's live-LLM scenario test in an e2e lane.
- system-migrations-runner:151 split into queue admission, startup refusal and worker composition; bind the startup half now (`bind-rest-night.md` §4).
- shared-scope-host:82 reword to the no-false-completion half (the walker never claims completion while loading or failed).

Leftover parts:
- Q121 fix scim `copy-input.tsx:40`'s raw error toast and re-add the tree-wide guard.
- Q166(1) _proposed_ 402 gets its own error type `payment_required` (today it reads `internal_error`).

## 4. D: AskUserQuestion items, in rounds of four

Order: parity gate first (round 1-2), then CI policy blockers, then framework and upgrade design.
Which D entries each question carries: 1-4 the 37 bind rows plus Q45, Q65, Q96, Q134, Q156, Q157; 5-7 P8484-R1 to R3; 8 Q209; 9-10 Q207; 11 Q205; 12 Q208 (A, B, D); 13 Q212; 14 Q211; 15 Q202(2), Q203; 16 Q202(3), Q204(A); 17 Q202(1), Q204(C), Q206; 18 Q39; 19 D3; 20-22 U2-API, U2-LIVE, U2-PHASES; 23 blitz line 72; 24 S3-ROLLBACK; 25 CH-1; 26-28 Q-U9, Q-U6, Q-U7.

### Round 1 (parity gate: 37 bind rows plus Q45, Q65, Q96, Q134, Q156, Q157)

1. **header** "Sign-in rows". **question** Eight sign-in and passkey scenarios that main proved with tests have no code on this branch (signin-signup-screens :205 :347 :579 :957 :965 :972 :979, passkeys :432): restore them as main had them?
   - "Restore all as main (Recommended)": port main's behaviour and tests; :347 refuses a passkey sign-up for an address now routed to SSO, :432 stops inventing an error code.
   - "Ask per row": I rule each of the eight separately.
   - "Tag @unimplemented": record them as gaps and drop main's behaviour.
2. **header** "Access rows". **question** Nine identity and access scenarios main proved are missing here (org-access-cluster :35 :47 :54 :70 grants gathered per holder; organization-authentication-settings :36 last clause and :129; scim-sso-signin :28; sso-credential-enforcement :111; mfa-and-session-shape :610): restore them as main?
   - "Restore all as main (Recommended)": the Access tab is the largest port (over 150 lines, main's role-holders model).
   - "Restore all but the Access tab": keep the per-grant list and reword the four org-access-cluster rows.
   - "Ask per row": I rule each one.
3. **header** "Langy cards". **question** Nine Langy card scenarios have a clear spec and a test on main but no code here (choice questions :57 :174 :187, composer :109, guided onboarding :405 :412 :428 :1341, session key :90): build them to the spec?
   - "Build to the spec (Recommended)": bare questions without Other, choices outside the "Made by Langy" frame, idle cards stop locking the field, quiet links, GitHub mark, path rows, non-delegable refusal copy.
   - "Build, but reword :174 and :428": keep today's card frame and icon.
   - "Ask per row": I rule each one.
4. **header** "Product rows". **question** Eleven product scenarios main proved are missing or differ here (instant-eval-billing :210, ingest-api-key-lifecycle :233, ui-contract :125, audit-log :371, evaluation-execution :230, governance-cost-screen :529, pulled-rows :43 :56, credential-validation :482, scenario-input-mapping :197, license-registry :64): restore them as main?
   - "Restore all as main (Recommended)": includes the one-line run-start fix (:230), the Codex gateway ping (:482), Scenario Mappings in the HTTP agent drawer via design-system as Q193 did (:197) and main's generate-license script as a licensing task (:64).
   - "Restore the small ones, ask the rest": fix :230, :233, :371, :482 now; ask about :64, :197, :529 and the leak-gate sweep.
   - "Ask per row": I rule each one.

### Round 2 (parity gate: the #8484 port, then a regression)

5. **header** "List cap". **question** Main's trace list now refuses a page size above 1000, while this branch clamps to the plan's ruled bound (1000, 2000 or 4000): which wins?
   - "Refuse above the plan bound (Recommended)": keep the ruled per-plan bound and refuse past it by name, as main refuses.
   - "Keep the clamp": amend the spec to the silent clamp.
   - "Cap tRPC at 1000": as main; paid plans lose their larger bound over tRPC.
6. **header** "Download cap". **question** Main lets a trace download read up to 10000 rows while this branch refuses above 4000: what should the download ceiling be?
   - "Fixed 10000 as main (Recommended)": a constant in the trace contract.
   - "Per-plan key": a new `tracesDownloadPageSizeMax` registry key.
   - "Keep 4000": amend the spec.
7. **header** "Annot. pages". **question** Main's annotations list has a filtered mode that walks trace pages, which this branch lacks; restore it?
   - "Restore with a seam (Recommended)": the shell passes the filter parameters in, so annotation takes no analytics edge.
   - "Restore with the edge": annotation-browser imports analytics' filter-params hook.
   - "Record a parity gap": two scenarios stay unbound as a known gap.
8. **header** "Event reads". **question** The api's event store refuses reads by design, so offloaded trace fields fall back to the 64 KB preview (a regression against main): how should trace read one event from event_log in the api?
   - "Narrow read seat (Recommended)": a separate single-event read beside the producer-only store, keeping main's 2-day window; the producer-only rule stands.
   - "Read-capable api log": the api role reads its own event log; amends the producer-only specs.
   - "Table exception": trace reads event_log directly as a named exception.

### Round 3 (CI: whole-tree policy blockers)

9. **header** "CH reads". **question** Governance, experiment and evaluation read trace_summaries, webhook reads gateway_spend, and trace joins other modules' tables in one statement: how should these cross-owner ClickHouse reads work?
   - "Api reads, rest ruled (Recommended)": new trace and gateway `*Api` query operations for plain reads; the single-statement subqueries become named policy exceptions.
   - "Denormalise": owners copy what they need through subscribers; no cross reads remain.
   - "All exceptions": record every finding as an accepted exception.
10. **header** "Trace tables". **question** Analytics queries trace's analytics tables by design and keeps its own copy of trace's signal predicate: who owns those tables?
    - "Analytics owns them (Recommended)": ownership moves to analytics and trace drops its copy.
    - "Trace query source": trace publishes a query-source contract analytics composes.
    - "Exception": record the reads as an accepted exception.
11. **header** "Event tables". **question** Data-retention rewrites eventing's event tables and analytics publishes them as LWQL views: how may modules touch eventing's tables?
    - "Eventing surfaces (Recommended)": eventing exposes a retention operation and declares its own LWQL catalogue entries, which analytics composes.
    - "Exceptions": record both as accepted policy exceptions.
    - "Retire the views": drop the event-table LWQL views (a product change).
12. **header** "Test exports". **question** Trace and gateway publish `./testing` subpath exports used by other modules' tests: keep test-only exports or move the fixtures into each consumer?
    - "Keep, lint-banned in prod (Recommended)": like the test-only peer seam (rulings:219); also add the enforcer `client` role so `<name>-client` may use @langwatch/api (linter follows the record, rulings:182).
    - "Move into consumers": each consumer owns its fixtures; the exports go.
    - "Ask per export": I rule each one.

### Round 4

13. **header** "Raw clients". **question** Better-auth's adapter needs raw Prisma, Redis and the cipher, and ops replay needs raw Redis and ClickHouse plus eventing definitions: may these hold raw clients?
    - "Named exceptions (Recommended)": linted, reasoned exceptions like auth's AsyncLocalStorage one (rulings:204); ops repositories stop calling peers (calls move into services).
    - "Framework surfaces": packages/process hands each a typed surface instead.
    - "Ask per site": I rule each one.
14. **header** "Blob store". **question** packages/group-queue imports stored-object's contract for its tiered blob store: invert the dependency or move the store?
    - "Inject mintUri (Recommended)": group-queue takes a mint function and a generic destination type.
    - "Move the store": the tiered blob store moves (touches packages/eventing and trace).
15. **header** "Lend props". **question** A lent component's props often name another module's types (prompt, workflow, dataset), and importing them would cycle: where do those props live?
    - "Structural props (Recommended)": restate the props as portable structural shapes, as Q193 did (rulings:223).
    - "Types move down": the shared types move to a contract both already use.
    - "Owner takes edges": prompt-contract takes the experiment and workflow edges.
16. **header** "React types". **question** Some lends pass ReactNode or HTMLDivElement props, but contracts import no framework (record §2): how are those props typed?
    - "Keep §2 strict (Recommended)": the token types such props without React (render slots typed `unknown`, narrowed by browser-host).
    - "Type-only exception": a contract may import React types type-only.
    - "Owner's browser types": props are typed in the owner's browser package and readers import them type-only.

### Round 5

17. **header** "Lend edges". **question** Converting the remaining declared() lends and named drawers adds browser-to-contract edges (experiment -> trace, project -> navigation and organization, navigation and api-key -> organization, and others): allow them?
    - "Allow the acyclic ones (Recommended)": any edge that closes no cycle is allowed; a cyclic one comes back to me.
    - "Allow none": those sites keep their bare names for now.
    - "Ask per edge": I rule each one.
18. **header** "Graph JSON". **question** The dashboard graph field arrives as JSON text: parse it in the contract schema or with a framework helper?
    - "Framework helper (Recommended)": a JSON-text field in packages/api keeps the browser's inferred types stable.
    - "Contract transform": parse inside the tRPC contract schema.
19. **header** "SQL owners". **question** Does "each module declares its own migrations, no central list" cover the SQL files too?
    - "Attribute only (Recommended)": SQL stays in the two central folders, each migration attributed to its table owner, one owner per migration.
    - "Move files into modules": per-module SQL folders assembled by the runner, a goose table per owner (moves 463 files).
    - "New SQL in modules": history stays central, new migrations live in modules.
20. **header** "Upgrade API". **question** The Upgrades page needs six reads, and every ops tRPC procedure calls `OpsApi`: how should ops expose them?
    - "Six OpsApi reads (Recommended)": status, releases, steps, step, runs, run, over an ops service on `UpgradeReader`.
    - "One sub-object": the same reads grouped under `OpsApi.upgrades`.
    - "Router calls a service": a packages/api change letting a router call a service directly.

### Round 6

21. **header** "Live status". **question** The Upgrades page was asked to poll during a run, but the record forbids timer polling: how does it stay live?
    - "Runner raises a hint (Recommended)": the runner publishes a read hint the api relays; no polling.
    - "Polling exception": poll only while a run holds the lease, like the suites exception.
    - "Refresh on show": the page reads when opened or refreshed.
22. **header** "Run phases". **question** The run view shows steps per release but not phases (preflight, schema per release, reconcile): record phases?
    - "In the run report (Recommended)": the runner writes phases in a fixed shape the reader parses; no new table.
    - "Phase table": a new ledger table.
    - "Steps are enough": drop phases from the page and its scenario.
23. **header** "Lapsed gate". **question** A serving process whose presence refresh keeps failing drops out of presence while still serving, so "old writers gone" can turn true early: what should it do?
    - "Stop serving (Recommended)": the gate stops serving once its last good presence write is older than the stale bound (ADR-173 names this).
    - "Accept the window": document it; a step may start before that writer stops.
24. **header** "Rollbacks". **question** A rollback that never runs `upgrade` is not detected, so level-triggered background steps are not reopened: detect it?
    - "From presence (Recommended)": an older image's live row after the last run reopens those steps.
    - "Accept": only an older image that itself runs `upgrade` reopens them.

### Round 7

25. **header** "Overload 503". **question** Main answered ClickHouse overload with 503 `clickhouse_overloaded`, but the masking rule turns it into `internal_error`: unmask it?
    - "Unmask overload (Recommended)": a transient overload refusal keeps its code (no customer data; clients retry on it), amending rulings:17/:21.
    - "Keep the mask": record the parity gap.
26. **header** "Ops renames". **question** Ten ops system-migration procedures on main's wire become `ops.upgrade.*`: rename outright or keep aliases?
    - "Rename, no aliases (Recommended)": operator-only procedures; accept the wire difference.
    - "Aliases for a release": keep the old names one release.
27. **header** "Cloud fleet". **question** Should LangWatch's own cloud regions send the same usage report so one fleet page covers cloud and self-hosted?
    - "One fleet page (Recommended)": regions report like any install.
    - "Per region": each region keeps its own page.
28. **header** "Alerts". **question** On self-hosted, should upgrade alerts email platform operators and show the operator banner, with Slack only where ops' notifier is set?
    - "Email and banner (Recommended)": the existing notification edge plus the banner; Slack only if configured.
    - "Banner only": no email.

## 5. E: waits on evidence or another lane

- **Blitz line 74** (ArgoCD/Flux hooks on rollback; does cloud's deploy run the pre-roll). Waits on access to the private deploy repository (plan §7 research gap).
- **SDK-1** (transcript path). Not an Alex question: the traces family is versioned (`traces.rest.ts:309-310`) and the document carries `/api/v1/traces/{traceId}/transcript` (`openapi-document.json:104642`), so the `BARE_ONLY` transcript entries in the three SDK tests are stale. A lane drops them.
- **107** second `langwatch login` drops `default_personal_vk`. Waits on a check of main's CLI behaviour.
- **128** system-migrations-runner rows (:392 D04, :273, :149-165). Waits on the migrations blitz porting tenant steps; :297/:306 are ruled (rulings:260).
- **partial-trace-id-resolution:66** CLI e2e. Waits on a binding lane in sdks/typescript (main bound it).
- **lwql-judgments-view:36, :42**, **query-reference:125**. Wait on a ClickHouse container harness (no Docker here).
- **join-before-create:208**. Behaviour exists (`JoinInsteadNotice`); waits on a binding lane.
- **langy-guided-onboarding:350**. Waits on a panel-level test lane.
- **Q143 leftover** (the `@architecture` tag, 86 scenarios). Waits on a count of how many have enforcer tests before ruling the tag enforced or excluded.
- **Usage D2** (trace-meter seed skips private data-plane organisations). Waits on the entitlement merge slice (64adc0f419) to say what the seed reads now.

Not triaged: the unnumbered "decided by the coordinator (for review)" bullets in `questions-2026-10-06.md`.
