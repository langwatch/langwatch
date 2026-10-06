# Held questions for Alex

Tracking issue: https://github.com/langwatch/langwatch/issues/8493; the PR-body refresh lane syncs it from this file.

Alex, 2026-10-06 night: "no more questions for now, hold them somewhere for me later". Every
question a lane or the coordinator raises goes HERE, not to Alex, until he asks for them. Ask them
only when he says so ("ask anything now" or similar), in rounds of four, recommendation first.

Standing instructions that hold until Alex says otherwise:

- Do work in lanes, never in the coordinator's own context (2026-10-06 evening).
- Keep PR #7536's body current with every decision, stat and lane outcome; refresh it through a lane
  after each landed batch (2026-10-06 night). Header and footer stay real and dated.
- Cut the PR body to a short squash summary just before merge (ruled 2026-10-06 night).
- A lane that hits an open question proceeds on the plan's marked recommendation where one exists,
  records it below as "default taken, held for Alex", and keeps going; with no recommendation it stops
  that item and records it here.

Format: one line per question: id, source file and section, the question, the options, the
recommendation, and "default taken" if a lane proceeded on it.

## Open

### Upgrade UI (dev/docs/plans/upgrade-ui-2026-10-06.md §11; Alex declined this round on 2026-10-06)

- Q-U5 Rollback rules: (1) a serving process refuses below the ledger's floor; (2) level-triggered background steps re-run after rollback and re-upgrade. Options: both, floor only, neither. Recommendation: both.
- Q-U6 Cloud regions in the fleet: regions send the same usage report so one fleet page covers cloud and self-hosted, or each region keeps its own page. Recommendation: report.
- Q-U7 Self-hosted alert channels: email platform operators plus the operator banner; Slack only where ops' notifier is configured. Recommendation: yes.
- Q-U8 How ops gets the upgrade reader: (a) ops' registry builds it and the framework hands the step list as a resource; (b) a framework-owned read surface; (c) the ledger alone with step metadata copied at run time. Framework shape; S6's design.
- Q-U9 Ten ops system-migration procedures become `ops.upgrade.*`: accept the operator-only wire difference, or aliases for one release. Recommendation: rename, no aliases.
- Q-U10 Organization admins see held or archived state: recommendation no (legacy path serves, refusals opaque, record §3.5).
- Q-U11 Steps carry a required one-line description shown in UI and CLI (SQL steps take the first comment): recommendation yes.

### Entitlement merge (M1 hand-back, 2026-10-06 night)

- Q1-upcast How stored `lw.usage.*` events become `lw.entitlement.*` (ruled: rename with an upcast). Eventing has no upcast hook (one type literal per schema, eventSchemas.ts:20-25; projections filter the exact type, projectionRouter.ts:1209,1383; replay discovers by type). Options: (a) a framework upcaster in packages/eventing applied at dispatch, store read and replay; (b) dual-read: legacy schemas beside the new, the process manager and billing's two peer subscribers registered on both types; (c) a ClickHouse step rewriting stored EventType and AggregateType plus a drain of the old queue keys. A pipeline rename also changes queue and dedup keys (queueManager.ts:338-339,359), so in-flight `countMonth` jobs need a drain. Facts: no usage projection reads these events back after delivery; only live subscribers and the process manager do. No recommendation yet; the rename slice waits on this. M1 landed with stored names unchanged.

### Legacy error body (legacy-error-root hand-back, 2026-10-06 night; landed)

- LE-1 Breadth: the root `error` is added only at statuses where a route publishes main's flat body (75 operations, 18 families); unpublished statuses (403 on most of them) get none, where main sent it on every status. Released clients only parse documented statuses. Options: keep (default taken, held for Alex) or every refusal of such a family (one line in packages/api/src/rest/legacy-error.ts).
- LE-2 Masked 5xx: main sent a HandledError 5xx's code unmasked; the branch masks per §12 and sends "Internal server error". Default taken: keep the mask.
- LE-3 Other legacy shapes not covered: `{error, kind?, meta?}` on evaluations-legacy, guardrails and dataset evaluate, and the CLI OAuth `{error, error_description}` (about 20 operations). Default taken: leave as they are until apidiff names a client break.

### Older numbered questions

- Up to 79 ids in `.claude/coordinator/questions-2026-10-06.md` that no ruling cites (Q11 to Q13, Q29 to Q39, Q43 to Q78, Q86 to Q152, Q155 to Q220); an upper bound, several are coordinator defaults for review.
- Bind round 2 rows (91 as written; identity 33, product 30, Langy and agents 15, platform 9, access 4), in the bind handoffs; re-count before asking.

## Answered (moved to `.claude/coordinator/rulings-2026-10-05.md` when ruled)

None yet since this file was created.
