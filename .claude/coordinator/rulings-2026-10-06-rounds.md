# Alex's answers to the question rounds, 2026-10-06 (late night)

Questions and options: `.claude/coordinator/ask-rounds-2026-10-06.json` (index in `ask-rounds-2026-10-06.md`). One line per answer, by round.

## Round 1 (D, parity regressions)

- Sign-in rows (Q65; signin-signup-screens :205 :347 :579 :957 :965 :972 :979; passkeys :432): RESTORE all as main had them, porting main's code and tests.
- Access rows (org-access-cluster :35 :47 :54 :70; organization-authentication-settings :36 :129; scim-sso-signin :28; sso-credential-enforcement :111; mfa-and-session-shape :610): RESTORE all as main, including the role-holders Access tab.
- Langy cards (Q134; langy-choice-questions :57 :174 :187; langy-composer-feedback-and-cards :109; langy-guided-onboarding :405 :412 :428 :1341; langy-session-key :90): BUILD to the spec.
- Product rows (Q45, Q96, Q156; instant-eval-billing :210; ui-contract :125; audit-log :371; evaluation-execution :230; governance-cost-screen :529; pulled-rows-home-and-leak-gate :43 :56; credential-validation :482; scenario-input-mapping :197; license-registry :64): RESTORE all as main.
