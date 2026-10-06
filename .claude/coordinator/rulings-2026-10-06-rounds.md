# Alex's answers to the question rounds, 2026-10-06 (late night)

Questions and options: `.claude/coordinator/ask-rounds-2026-10-06.json` (index in `ask-rounds-2026-10-06.md`). One line per answer, by round.

## Round 1 (D, parity regressions)

- Sign-in rows (Q65; signin-signup-screens :205 :347 :579 :957 :965 :972 :979; passkeys :432): RESTORE all as main had them, porting main's code and tests.
- Access rows (org-access-cluster :35 :47 :54 :70; organization-authentication-settings :36 :129; scim-sso-signin :28; sso-credential-enforcement :111; mfa-and-session-shape :610): RESTORE all as main, including the role-holders Access tab.
- Langy cards (Q134; langy-choice-questions :57 :174 :187; langy-composer-feedback-and-cards :109; langy-guided-onboarding :405 :412 :428 :1341; langy-session-key :90): BUILD to the spec.
- Product rows (Q45, Q96, Q156; instant-eval-billing :210; ui-contract :125; audit-log :371; evaluation-execution :230; governance-cost-screen :529; pulled-rows-home-and-leak-gate :43 :56; credential-validation :482; scenario-input-mapping :197; license-registry :64): RESTORE all as main.

## Round 2 (D, session cap and the #8484 port)

- Session cap (Q157; ingest-api-key-lifecycle :233): REVOKE on refresh as main; the refused refresh revokes both keys with cause 'expired' at once (modules/auth); the reaper stays as a backstop.
- List cap (P8484-R1): REFUSE above the plan's bound, by name; paid plans keep their larger pages.
- Download cap (P8484-R2): a PER-PLAN key, `tracesDownloadPageSizeMax`, in the plan registry (not the recommended fixed 10000).
- Annotation pages (P8484-R3): RESTORE the filtered mode with a seam; the shell passes the filter parameters in, annotation takes no analytics edge.

## Round 3 (D, event reads and ClickHouse ownership)

- Event reads (Q209): a NARROW read seat, a separate single-event read beside the producer-only store, keeping main's 2-day window; the producer-only rule stands.
- Cross-owner ClickHouse reads (Q207): new trace and gateway *Api query operations for plain reads; one-statement subqueries become named policy exceptions.
- Trace analytics tables (Q207): ANALYTICS owns them; trace drops its copy of the has-signal predicate.
- Unowned ClickHouse tables (Q207): RECORD event_log as framework owned and the six legacy tables as legacy owned in the policy; nothing dropped.

## Round 4 (D, CI policy blockers)

- Event tables (Q205): EVENTING surfaces; eventing exposes a retention operation and declares its own LWQL catalogue entries, which analytics composes.
- Test exports (Q208): MOVE the fixtures into each consuming module; trace's and gateway's './testing' exports go (not the recommended keep).
- Client role (Q208): ADD a 'client' role to the enforcer allowing @langwatch/api and React; the linter follows the record.
- Shell types (Q208): the MODULE's contract; auth and navigation contracts export the types and apps/ui imports them type-only; the side doors go.

## Round 5 (D, raw clients, ops repositories, group-queue)

- Raw clients (Q212): NAMED, linted exceptions with a written reason for Better Auth's storage adapter and ops' event replay; ops' memory registry may require eventing.
- Ops repositories (Q212): MOVE the peer Api calls into ops' services; repositories take only ops' own store.
- ClickHouse health (Q212): resolve CLICKHOUSE_URL through secrets.into at boot and pass it in.
- Blob store (Q211): INJECT mintUri; group-queue takes a mint function and a generic destination type, no module import.

## Round 6 (D, framework seams and lent props)

- ClickHouse managed-table list (Q211): INJECT via the constructor; apps/tasks passes the list into ClickHouseMigrateTask and the data-retention dependency goes.
- Facet rules (Q211): the two trace rules files become SERVICES; rules stay free of ClickHouse.
- Lent props naming another module's types (Q202, Q203): STRUCTURAL props, restated as portable shapes; no new edges.
- React-typed lent props (Q202, Q204): Alex asked back "lent components shouldn't be in contracts?"; clarification asked, see round 6b.
- Round 6b, token home (Q202, Q204): KEEP the record; tokens stay in the owner's contract, React-shaped props become data (text, ids), and render slots are typed unknown and narrowed by browser-host.
