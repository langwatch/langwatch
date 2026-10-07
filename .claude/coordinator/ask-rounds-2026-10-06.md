# Ask rounds, 2026-10-06

Index for `ask-rounds-2026-10-06.json`: 39 rounds, 155 questions (D: 10 rounds, 40 questions; C: 29 rounds, 115 questions). Source: `question-triage-2026-10-06.md` sections 3 and 4, `held-questions.md`, `questions-2026-10-06.md`.
Record each answer against the ids on its question line. In every question the first option is the recommendation (for C, the default taken or proposed).

Beyond the triage's 28 D questions: ingest-api-key-lifecycle:233 asked on its own; Q208 split into (A), (B), (D); Q212 split into R2, R3, R4; untriaged parts Q204(B), Q207(F), Q211(B), Q211(D) added; held items OTLP-REPORT, T1-D2-canon and T1-D2-deps-extra added, and the Trace 9 wire note asked with CH-1. Beyond the triage's 102 C entries: multi-part entries asked one default per question; oversized-operator-surface and ops-upgrade-image-steps added.

## Round 1 (D): Parity regressions

- **Sign-in rows**: signin-signup-screens:205, signin-signup-screens:347, signin-signup-screens:579, signin-signup-screens:957, signin-signup-screens:965, signin-signup-screens:972, signin-signup-screens:979, passkeys:432, Q65. Answer:
- **Access rows**: org-access-cluster:35, org-access-cluster:47, org-access-cluster:54, org-access-cluster:70, organization-authentication-settings:36, organization-authentication-settings:129, scim-sso-signin:28, sso-credential-enforcement:111, mfa-and-session-shape:610. Answer:
- **Langy cards**: langy-choice-questions:57, langy-choice-questions:174, langy-choice-questions:187, langy-composer-feedback-and-cards:109, langy-guided-onboarding:405, langy-guided-onboarding:412, langy-guided-onboarding:428, langy-guided-onboarding:1341, langy-session-key:90, Q134. Answer:
- **Product rows**: instant-eval-billing:210, ui-contract:125, audit-log:371, evaluation-execution:230, governance-cost-screen:529, pulled-rows-home-and-leak-gate:43, pulled-rows-home-and-leak-gate:56, credential-validation:482, scenario-input-mapping:197, license-registry:64, Q45, Q96, Q156. Answer:

## Round 2 (D): Parity regressions / Main #8484 port

- **Session cap**: ingest-api-key-lifecycle:233, Q157. Answer:
- **List cap**: P8484-R1. Answer:
- **Download cap**: P8484-R2. Answer:
- **Annot. pages**: P8484-R3. Answer:

## Round 3 (D): Parity gate: trace event reads / CI policy and lent props

- **Event reads**: Q209, Q205(A). Answer:
- **CH reads**: Q207(A), Q207(B), Q207(C). Answer:
- **Trace tables**: Q207(D). Answer:
- **Unowned CH**: Q207(F). Answer:

## Round 4 (D): CI policy and lent props

- **Event tables**: Q205(B), Q205(C). Answer:
- **Test exports**: Q208(D). Answer:
- **Client role**: Q208(A). Answer:
- **Shell types**: Q208(B). Answer:

## Round 5 (D): CI policy and lent props

- **Raw clients**: Q212(R4). Answer:
- **Ops repos**: Q212(R2). Answer:
- **CH health**: Q212(R3). Answer:
- **Blob store**: Q211(C). Answer:

## Round 6 (D): CI policy and lent props

- **CH tbl list**: Q211(B). Answer:
- **Facet rules**: Q211(D). Answer:
- **Lend props**: Q202(2), Q203. Answer:
- **React types**: Q202(3), Q204(A). Answer:

## Round 7 (D): CI policy and lent props / Framework and upgrade design

- **Lent hooks**: Q204(B). Answer:
- **Lend edges**: Q202(1), Q204(C), Q206. Answer:
- **Graph JSON**: Q39. Answer:
- **SQL owners**: D3. Answer:

## Round 8 (D): Framework and upgrade design

- **Span canon**: T1-D2-canon. Answer:
- **Decoder deps**: T1-D2-deps-extra. Answer:
- **Upgrade API**: U2-API. Answer:
- **Live status**: U2-LIVE. Answer:

## Round 9 (D): Framework and upgrade design

- **Run phases**: U2-PHASES. Answer:
- **Lapsed gate**: held:72. Answer:
- **Rollbacks**: S3-ROLLBACK. Answer:
- **Masked 503s**: CH-1, Trace-9-wire. Answer:

## Round 10 (D): Framework and upgrade design

- **OTLP report**: OTLP-REPORT. Answer:
- **Ops renames**: Q-U9. Answer:
- **Cloud fleet**: Q-U6. Answer:
- **Alerts**: Q-U7. Answer:

## Round 11 (C): Upgrade design

- **One model**: D1. Answer:
- **Presence**: D2. Answer:
- **Target table**: D4. Answer:
- **Gate hook**: D5. Answer:

## Round 12 (C): Upgrade design

- **Lock guard**: D6. Answer:
- **CI gates**: D7. Answer:
- **Cloud floor**: D8. Answer:
- **Manifests**: D9. Answer:

## Round 13 (C): Upgrade design

- **First floor**: D10. Answer:
- **Collisions**: D11. Answer:
- **Floor rules**: Q-U5. Answer:
- **Org admins**: Q-U10. Answer:

## Round 14 (C): Upgrade design

- **Step text**: Q-U11. Answer:
- **Who runs**: Q-U8, UP-3. Answer:
- **imageSteps**: Q-U8 (ops-upgrade-image-steps). Answer:
- **CH targets**: S4-TARGETS. Answer:

## Round 15 (C): Step declaration and upcasts

- **Checkpoint**: mig-declare (checkpoint). Answer:
- **Upcast decl**: mig-declare (upcasts). Answer:
- **Step checks**: mig-declare (rules). Answer:
- **Upcast kind**: UP-1. Answer:

## Round 16 (C): Step declaration and upcasts

- **Upcast id**: UP-2. Answer:
- **Rewrite**: UP-4. Answer:
- **Drain life**: UP-5. Answer:
- **Fresh inst.**: held:69 (fresh-install upcast). Answer:

## Round 17 (C): Upgrade reader and checkup

- **Empty ledger**: U1-a. Answer:
- **Upgrading**: U1-b. Answer:
- **Reader wire**: U1-c. Answer:
- **Refused run**: S3-REFUSED-RUN. Answer:

## Round 18 (C): Upgrade reader and checkup

- **Image ver**: S3-IMAGE. Answer:
- **DB clock**: held:67 (ledger widening). Answer:
- **Checkup row**: U3-a. Answer:
- **Doctor**: U3-b. Answer:

## Round 19 (C): Presence and serving gate

- **No clock**: held:70 (presence clock). Answer:
- **No writers**: held:71 (oldWritersGoneFor). Answer:
- **Name clash**: held:75 (presence name). Answer:
- **Heartbeat**: held:89 (presence timings). Answer:

## Round 20 (C): Presence and serving gate

- **Gate pool**: held:84 (gate data source). Answer:
- **No CH target**: S3-NO-CLICKHOUSE. Answer:
- **First boot**: S3-FIRST-INSTALL. Answer:
- **Tenant pass**: S3-PREPARE-PASS. Answer:

## Round 21 (C): Runner, guard and stamp

- **Bootstrap**: S3-BOOTSTRAP. Answer:
- **Timings**: S3-TIMINGS. Answer:
- **Retry**: S3-RETRY. Answer:
- **Old indexes**: held:64 (NEW_RULES_FROM). Answer:

## Round 22 (C): Runner, guard and stamp

- **Two owners**: held:65 (two-owner check). Answer:
- **NOT NULL**: held:66 (set-not-null). Answer:
- **Owner map**: held:68 (stamp owners). Answer:
- **Stamp now**: mig-ci stamp. Answer:

## Round 23 (C): Migration CI and storage

- **Advisory CI**: mig-ci D7a. Answer:
- **Prisma drift**: mig-ci D7b. Answer:
- **No live base**: mig-ci D7c. Answer:
- **Smoke scope**: mig-ci D7d. Answer:

## Round 24 (C): Migration CI and storage / Wire and API shape

- **Goose number**: mig-ci D11. Answer:
- **Live fixture**: AD-2. Answer:
- **Retention**: oversized-operator-surface. Answer:
- **Legacy body**: LE-1. Answer:

## Round 25 (C): Wire and API shape

- **Other bodies**: LE-3. Answer:
- **Graph size**: Q29. Answer:
- **Dataset sum**: apidiff (dataset records). Answer:
- **Agent rename**: AD-1. Answer:

## Round 26 (C): Wire and API shape / Identity and access

- **402 type**: Q166(1). Answer:
- **OTLP decoder**: T1-D2-deps. Answer:
- **New reads**: T1-D2-deps (review). Answer:
- **Cred specs**: Q55. Answer:

## Round 27 (C): Identity and access

- **Weak binds**: Q62 (binds). Answer:
- **Tiers order**: Q62 (sso-onboarding-tiers:85). Answer:
- **Offboarding**: Q88. Answer:
- **OKTA chip**: Q168 (OKTA). Answer:

## Round 28 (C): Identity and access

- **Delete copy**: Q168 (SCIM dialog). Answer:
- **Break-glass**: Q168 (break-glass). Answer:
- **Org guard**: Q169 (organization guard). Answer:
- **SAML tests**: Q169 (SAML rows). Answer:

## Round 29 (C): Identity and access

- **Login guard**: Q172. Answer:
- **Team 404**: Q201(1). Answer:
- **Team keys**: Q201(2). Answer:
- **Audit test**: audit-log:83. Answer:

## Round 30 (C): Identity and access

- **Audit conn**: audit-log:91. Answer:
- **Audit access**: audit-log:177. Answer:
- **Authz boot**: authz package-boundary:125. Answer:
- **Epoch helper**: Q195. Answer:

## Round 31 (C): Identity and access / Platform and server

- **Authz cache**: Q191. Answer:
- **Blank key**: Q53, platform-health:95. Answer:
- **Dead branch**: Q68, invitations:123. Answer:
- **GitHub creds**: github-branch-maintenance:90. Answer:

## Round 32 (C): Platform and server

- **Memory limit**: Q173. Answer:
- **Redis needed**: Q199(1). Answer:
- **OTEL headers**: Q199(2). Answer:
- **FK assert**: Q199(3). Answer:

## Round 33 (C): Platform and server

- **Channels**: Q210(1). Answer:
- **Pick types**: Q210(2). Answer:
- **Memory twins**: Q210(5). Answer:
- **Facet export**: Q214(1). Answer:

## Round 34 (C): Platform and server

- **Signal copy**: Q214(2). Answer:
- **Puller svc**: Q220. Answer:
- **S3 settings**: Q197. Answer:
- **Slot gate**: Q146, feature-package-boundaries:9. Answer:

## Round 35 (C): Platform and server

- **Old rule**: Q146, strict-feature-layout:92. Answer:
- **Preflight**: system-migrations-runner:151. Answer:
- **Env example**: fresh-clone-dev-setup:40. Answer:
- **Azure task**: Q217(1). Answer:

## Round 36 (C): Platform and server

- **Lazy Azure**: Q217(2). Answer:
- **Staging dead**: Q217(5). Answer:
- **Leak test**: ui-contract:314, Q156. Answer:
- **Route sweep**: Q167(1). Answer:

## Round 37 (C): Platform and server / Product and UI

- **Middleware**: Q167(2). Answer:
- **completeCode**: Q54. Answer:
- **Excluded ids**: Q75. Answer:
- **Langy retry**: Q165. Answer:

## Round 38 (C): Product and UI

- **2x submit**: Q188. Answer:
- **Agent row**: Q168 (agent type-select). Answer:
- **Gateway tour**: Q169 (gateway tour). Answer:
- **Home pills**: guided-onboarding-offer:39, guided-onboarding-offer:109. Answer:

## Round 39 (C): Product and UI

- **Thumbs-down**: langy-trace-explorer-actions:220. Answer:
- **Queue state**: shared-scope-host:82. Answer:
- **Copy toast**: Q121. Answer:
