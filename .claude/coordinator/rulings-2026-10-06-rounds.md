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
