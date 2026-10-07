# Priority questions, 2026-10-07 (early)

Alex will answer at most 15 to 20 more tonight. These 20, in 5 rounds of 4, unblock the most nearly-ready work. Payloads: `ask-priority-2026-10-07.json`. Ask round by round; if Alex stops after round 4, the 16 most useful are answered.

Sources: unasked rounds 24 to 39 of `ask-rounds-2026-10-06.json` (63 questions); held entries in `held-questions.md` that lanes added tonight and that the JSON does not carry; answers in `rulings-2026-10-06-rounds.md`; lane state in `slate-2026-10-06-rulings.md` and the handoffs' "Exact next action" lines.

Rule used for ranking: a lane can proceed on a marked recommendation (held-questions standing instruction). So items with **no** recommendation, or a recommendation the lane's manifest barred, block work outright and rank first. Next come proposals that need Alex's yes by their nature: spec rewordings, retirements, wire changes and framework direction. Confirmations of code as built rank last; they block nothing.

## 1. Counts

| group                                       | count |                                  of which chosen |
| ------------------------------------------- | ----: | -----------------------------------------------: |
| Unasked JSON (rounds 24 to 39)              |    63 | 28 JSON questions, folded into 8 asked questions |
| ...of those, moot by a later ruling or code |     3 |                                                  |
| New held, no default                        |    17 |                                               13 |
| New held, default taken                     |    40 |                                                0 |
| New held, moot by a later ruling            |    19 |                                                  |

Open after moot: 60 JSON + 17 + 40 = **117**. Asked here: 20 questions covering **41 ids** (28 JSON, 13 held). Rounds: **5**.

### Moot (the ruling line, or the code, that settles each)

JSON:

- Q214(2) trace's has-signal export: round 3 "Trace analytics tables (Q207): ANALYTICS owns them; trace drops its copy of the has-signal predicate."
- Q169 (gateway tour) lend vs new edge: round 7b "TOKENS move to each owner's <name>-client package; readers' browser packages import it." The tour token goes to onboarding's client in r-lends-3.
- Q217(5) unused staging classes: already deleted in code, e6cdf62c1f (no `PayloadStaging*` left in stored-object src).

Held:

- a-billing-governance, leak gate (four surfaces): round 1 "Product rows ... RESTORE all as main"; built by leaks-529 (`HELD_LEAKS` emptied).
- a-billing-governance, governance-cost-screen :529 owner: round 1, same line; built by leaks-529 in gateway's spend repository.
- a-billing-governance, Q69 shape: round 11 "Stripe channel (Q69): PER-SUBJECT channels".
- auth-followups, Auth 32: round 13 "Adopt account (Auth 32, Q150): ONE new UserApi.adoptUnconfirmedAccount".
- auth-32, finalized users: round 20 "Adopt gap (Auth 32, finalized users): the identifier backfill NEVER finalizes ...". (Its new release-order line is open and asked: round 1.)
- lwql-sync-eval, inline-eval peer cycle: round 20 "Judge cycle (lwql-sync-eval): ALLOW analytics -> InstantEvalApi".
- sso-instant-eval, instant-eval-billing :210: round 13 "Inline eval ... RESTORE synchronous judging as main had it".
- a-auth-process-rows, ingest-api-key-lifecycle :233 (Q157): round 2 "Session cap (Q157 ...): REVOKE on refresh as main ... with cause 'expired'".
- q69, where meters sit: round 23 "Meters (Q69-4): a SIXTH subject channel".
- q69, connected invoicing: round 23 "Connected invoicing (Q69-4): STAYS one channel".
- q69, channel shapes (Q69-2 default): round 23 "Stripe types (Q69-2 default): DOMAIN shapes". This overturns the default, so it is now work for Q69-4 or a follow-on.
- r-annotation-filtered, walk page size: round 20 "Walk size (annotations filtered list): KEEP 1000".
- r-annotation-filtered, who fills the seam: round 20 "Trace filters (P8484-R3 seam): ANALYTICS lends a traceFilters browser-host capability".
- r-eventing-surfaces, how a module receives the seat: round 22 "Seat wiring (Q209, clarified): ... TRACE's registry builds an event-payloads repository over it".
- r-upgrade-runner, lapsed gate path to stop serving: round 22 "Stop serving (lapsed presence): /readyz turns 503 ... AND a worker pauses taking jobs".
- process-doors-ready-metrics, readiness latches: round 22, same line, "Readiness must be able to turn off again". This overturns the default and is now work.
- Migrations blitz, line 74 (do rollbacks run pre-upgrade hooks): round 9 "Rollbacks (S3-ROLLBACK): detect FROM presence".
- LE-2 masked 5xx: triage bucket A (record §12), done in eca3d819d3.
- Q-U2 "release upgrade" copy: triage bucket A, done in 8723ee4dde.

## 2. Chosen, in asking order

|   # | header       | ids                                                                                                                                                                                                      | unblocks                                                                                                                                                                                                                                                       |
| --: | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Ship order   | auth-32 (release order)                                                                                                                                                                                  | **Security.** Shipping auth-32 slice 2 (adoption wiring, written and held). Until it is ruled, the slice cannot deploy safely.                                                                                                                                 |
|   2 | Ops replay   | r-ops-registry-seams (replay runtime)                                                                                                                                                                    | r-ops-registry-seams slice 4 and then slice 5; after them, the queued r-ops-upgrade-page (U2 Upgrades page).                                                                                                                                                   |
|   3 | Access tab   | a-signin-access-screens (org-access-cluster :35 :47 :54 :70)                                                                                                                                             | A new lane on `modules/authz/browser`: main's role-holders model and its two tests. Four rows bound.                                                                                                                                                           |
|   4 | Upgrade dep  | ent-merge M2                                                                                                                                                                                             | ent-merge slice M2, the entitlement `.withMigrations` step (stopped).                                                                                                                                                                                          |
|   5 | Refusal cap  | a-product-restore (audit-log :371)                                                                                                                                                                       | Apply a-product-restore §10, which is already written, and port the budget test. Binds :371.                                                                                                                                                                   |
|   6 | SCIM login   | a-auth-process-rows (scim-sso-signin :28)                                                                                                                                                                | An auth-process slice for :28.                                                                                                                                                                                                                                 |
|   7 | SSO card     | a-signin-access-screens (organization-authentication-settings :36)                                                                                                                                       | An sso-browser slice. Binds :36.                                                                                                                                                                                                                               |
|   8 | License task | a-product-restore (license-registry :64)                                                                                                                                                                 | The licensing `generate-license` task slice, with main's rollback test.                                                                                                                                                                                        |
|   9 | Codex ping   | a-product-restore (credential-validation :482)                                                                                                                                                           | The model-provider Codex ping slice. Langy and gateway both depend on model-provider, so a peer call is a cycle.                                                                                                                                               |
|  10 | Bind rows    | audit-log :91 :177; authz package-boundary :125; Q172; Q62 (two); shared-scope-host :82; guided-onboarding-offer :39 :109; Q167(1); Q167(2)                                                              | One bind lane. About ten unbound rows become bound, toward the parity zero target.                                                                                                                                                                             |
|  11 | Spec tidy    | Q53; github-branch-maintenance :90; Q146 (feature-package-boundaries :9, strict-feature-layout :92); Q68 (invitations :123); system-migrations-runner :151; Q168 (agent type-select); Q55; audit-log :83 | One spec lane: tags, retirements, splits and the organisation dead-branch deletion. A packages/api host test for :83.                                                                                                                                          |
|  12 | Project leak | ui-contract :314                                                                                                                                                                                         | A small project-module lane that filters three finders (one feeds `/api/v1/projects`; main's listings hid the governance project, per `governance-project-route-guard.integration.test.ts`). Recommendation changed from "Reword" to "Reword and add filters". |
|  13 | Small fixes  | Q121; fresh-clone-dev-setup :40; Q220; Q199(3); Q166(1)                                                                                                                                                  | Four or five tiny lanes: the scim browser toast and tree guard, `.env.example`, governance dead code, a slack test assertion, and the packages/api 402 type.                                                                                                   |
|  14 | UI config    | browser-supply BS-2                                                                                                                                                                                      | A fresh browser-supply lane, Method step 2. Strict config must wait until this is ruled.                                                                                                                                                                       |
|  15 | Config type  | browser-supply BS-3                                                                                                                                                                                      | The same lane, Method step 3.                                                                                                                                                                                                                                  |
|  16 | Channels     | Q210(1)                                                                                                                                                                                                  | A packages/process framework lane (`.withChannels`), then ten channel conversions.                                                                                                                                                                             |
|  17 | Memory twins | Q210(5)                                                                                                                                                                                                  | Up to eight module lanes for real memory twins (enterprise-gateway, governance, licensing, saas, instant-eval, log, metric, usage).                                                                                                                            |
|  18 | Ops audit    | r-ops-registry-seams (audit trail reads)                                                                                                                                                                 | Ops' audit read side through AuditLogApi and UserApi (handoff §12.4), which clears a table-ownership breach and the empty memory trail.                                                                                                                        |
|  19 | Pick types   | Q210(2)                                                                                                                                                                                                  | Five consumer conversions to `*Api`, then the abstract services are deleted.                                                                                                                                                                                   |
|  20 | Old pods     | ent-merge M-R (rolling deploy)                                                                                                                                                                           | An eventing lane: retry an undeclared queued type during drain. packages/eventing is free now that r-eventing-surfaces has handed back. This protects the entitlement merge's deploy.                                                                          |

## 3. Can wait (default stands)

None of these blocks a lane. Each default is built or is being built, so a later yes changes nothing.

**New held, default taken (40):**

- ent-merge-mr-m6: M-R table names kept; M-R meter lane names kept; M-R constant names kept; M3 ports billing's per-project `uniq` query (the queued r-ent-merge-m3 proceeds on it).
- harness-live-oidc: ID-2, the test lives in auth (option a; `sso-oidc-sign-in.integration.test.ts` exists).
- t1-d2-span-facts: the inlined tenant check throws a plain Error.
- browser-supply-1-3: BS-1, the undeclared drawer is refused and the address stripped.
- process-doors-ready-metrics: the chart readinessProbe asks /readyz; store checks (one cheap query per opened client); Node default metrics appended. (Readiness latching is moot; see section 1.)
- rest-owner-map: `restNamespaces` field; `RestSharedPath` with `permanent`; RestHost refuses under the claimed base path.
- land-five: api-process-executable test kept unbound; `browser_drawer_undeclared` listed as client-minted.
- a-legacy-key-stale-rows: new projects store `lw-revoked-<ksuid>`; `generateApiKey` keeps its name.
- a-identity-sso-process: mfa-and-session-shape :524 decision records as main; identifier-model :129 provisional write (ADR-135 needs amending).
- a-run-page-http-mappings: run page at the existing redirect address; suite list row shows Agent-role latency.
- a-auth-process-rows: mfa-and-session-shape :555 bound on the shipped inline DML.
- leaks-529: the model-defaults picker drops archived projects (a wire difference).
- q69: transitional raw client (removed by Q69-4); line items threaded per call (Q69-3).
- r-framework-inject: `managedTables` optional.
- r-transient-503-json-field: `./json-text-field` subpath export.
- r-eventing-surfaces: read seat takes the full stream boundary; retention takes the caller's client; an empty category runs no statement.
- r-lend-record-client-role: the client may not import `@langwatch/browser`; extension tokens live in the host's client; §7 legacy body kept; a client depends only on its own contract.
- r-upgrade-runner: the U2-LIVE hint shape; U2-PHASES schema phases share timing; S3-ROLLBACK's "older image" rule.
- r-ops-registry-seams: the ClickHouse health premise is stale (ping only, no URL).
- r-policy-ownership: raw-client exceptions name today's files (inert until the rule reads members); the migration-owners policy keeps its shrink-only list.

**Unasked JSON, as built or the proposal stands (29):** mig-ci D11; AD-2; OBJECT_RETENTION_CONFIRMED (oversized-operator-surface); LE-1; LE-3; Q29; apidiff dataset summary; AD-1; T1-D2-deps (built as (a)); T1-D2-deps review; Q88; Q168 OKTA chip; Q168 SCIM delete copy; Q168 break-glass; Q169 organisation guard (landed 6b6222aa95); Q169 SAML tests; Q201(1); Q201(2); Q195; Q191; Q173; Q199(1); Q199(2); Q197; Q217(2); Q54; Q75; Q165 (check that services/langyagent does not also retry); Q188.

## 4. Needs Alex later

No lane is waiting on these tonight, but each needs his call before the PR merges.

- **r-policy-ownership, lwql_api_key_tenant_map owner** (no default). Ranked 21st, so it was cut when auth-32 went in. One no-owner finding stays. Ask it as: attribute the table to analytics (teach the policy the computed name), or record it as legacy.
- **SDK-1** (no default): the generated Python client publishes `/api/v1/traces/{trace_id}/transcript` while BARE_ONLY says trace has no v1 twin. Needs a look at the trace routes' addressing first (triage bucket E).
- **r-transient-503-json-field, tRPC masks no handled 5xx** (no default): whether tRPC gains REST's 5xx mask. A wire change; nothing waits on it.
- **r-framework-inject, retention-ttl test home** (no default; the lane recommends moving it into data-retention). The record lets a module import a framework package, so the coordinator may take the recommendation without Alex. The handoff's next action already plans that lane.
- **Q214(1) facet export**: whether module-classes ignores private classes. This is lint semantics; it fits the r-trace-facet-services lane, which is queued behind the trace chain.
- **Q217(1) azure-blob-workload-identity :344**: bind, retire or hold. It depends on the migrations rethink of the storage task.
- **langy-trace-explorer-actions :220**: port main's 240-line live-LLM e2e, or tag it. This is a costly lane and not urgent.
