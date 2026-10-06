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

## Round 7 (D, lends, graph JSON, SQL ownership)

- Lent hooks (Q204): a HOOKS token read through useLentHooks, like GuidedTourToken.
- Lend edges (Q202, Q204, Q206): Alex: "maybe we keep using names? idk acyclic is fine, but maybe we use client packages?"; clarification asked, see round 7b.
- Graph JSON (Q39): a FRAMEWORK helper, a JSON-text field in packages/api; the browser's inferred types stay stable.
- SQL owners (D3): ATTRIBUTE only; SQL stays central, each migration is attributed to its table's owner, and a check refuses one touching two owners.
- Round 7b, lend edges (Q202, Q204, Q206): TOKENS move to each owner's <name>-client package; readers' browser packages import it; React-typed props are allowed there. This SUPERSEDES round 6b (tokens in the contract, data-only props) and changes the record's §10.1 "a token lives in its owner's contract".

## Round 8 (D, span facts and the Upgrades page)

- Span canon (T1-D2-canon): ADD TraceApi.canonicalizeSpanAttributes, the twin of canonicalizeLogRecord (supersedes the "no new TraceApi operation" wording for this one).
- Decoder deps (T1-D2-deps-extra): INLINE the ESpanKind enum and the tenant check in trace-contract; no new contract dependency.
- Upgrade API (U2-API): SIX OpsApi reads (status, releases, steps, step, runs, run) backed by an ops service over UpgradeReader.
- Live status (U2-LIVE): the upgrade RUNNER raises a read hint the api relays; the page refreshes on it, no polling.

## Round 9 (D, upgrade runner and masked 503s)

- Run phases (U2-PHASES): IN the run report; the runner writes phases in a fixed shape the reader parses, no new table.
- Lapsed gate (cloud presence): STOP serving once the last good presence write is older than the stale bound (60 s).
- Rollbacks (S3-ROLLBACK): detect FROM presence; an older image's live presence row after the last run reopens level-triggered background steps.
- Masked 503s (CH-1, Trace 9 wire): UNMASK transient 503 refusals (clickhouse_overloaded, service_unavailable); amends the 5xx masking ruling.

## Round 10 (D, upgrade surfaces)

- OTLP report (OTLP-REPORT): REMOVE TraceApi.otlpReportError from the trace contract and app.
- Ops renames (Q-U9): RENAME to ops.upgrade.*, no aliases; the wire difference is accepted.
- Cloud fleet (Q-U6): ONE fleet page; cloud regions send the same usage report as self-hosted installs.
- Alerts (Q-U7): EMAIL platform operators and show the operator banner; Slack only where ops' notifier is configured.

## Round 11 (D, upgrade design kept as built)

- One model (D1): KEEP one ledger keyed by step id (and target) for cloud and self-hosted (ADR-173).
- Presence (D2): KEEP the runner-owned presence table; minimumWriterGeneration stays as an override.
- Target table (D4): KEEP the child table _langwatch_upgrade_target.
- Gate hook (D5): KEEP the withUpgradeGate preamble step in packages/process for api and worker.
