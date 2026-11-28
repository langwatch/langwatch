# ADR-003: The weekly digest is one feed email of capped rows

**Status:** Accepted (2026-11-27)

**Behavioural contract:** [Weekly digest emails](../specs/digest.feature)

**Amends:** [ADR-001](./001-digest-boundary.md) (the template pick) and
[ADR-002](./002-per-organization-email-for-everyone.md) (what one email says).

## Context

ADR-001 picked one of five templates per person ("the first eligible template wins"): plan
pressure, scenarios trend, coding-agent week, traces week, what's new. A person saw one signal a
week and missed the rest: a flooded organization's admin got the plan and never the failing
scenarios, and a thin organization under 1,000 traces got nothing, since what's new never sends.
The agreed redesign (variant B of the digest mockup) is one feed email: rows of a coloured chip,
a linked title and one context line.

## Decision

- **One template, `digest-week`.** `DIGEST_TEMPLATE_IDS` is `["digest-week"]`. One email per
  person per organization, as ADR-002 has it; its subject is the first row's title, prefixed
  with the organization's name by the send. No row names the organization itself, so the subject
  never reads "Acme: Acme has...".
- **Rows, in priority order** (`digest-rows.rules.ts`): the plan at 80% or more of a finite limit
  (admins only); regressions, a scenario failure rate or an eval pass rate 10 points or more
  worse than its four-week weighted baseline, biggest first, at most two; quiet projects (no
  traces this week, a read last week above none); Set up (traces, and no eval on any visible
  project in five weeks); the reader's own coding agents (5 or more sessions, never their cost);
  the busiest project's traces (any week with one); recoveries (10 points or more better).
- **Evals compare with 20 checks or more** this week and in the baseline; fewer is not compared
  and not called steady. Scenarios and evals are read for every visible project, not only the
  busiest.
- **Five rows and two buttons at most.** A row cut by the cap folds into the "Also this week"
  line by title; a third regression folds too. Only the first two rows that carry a button keep
  it.
- **At most one New row, always last**, a text link and never a button, picked from the reader's
  own numbers. Only one pick ships: the busiest project with traces and no scenario run in five
  weeks is offered its first scenario. A New row that does not fit is dropped, not folded.
- **The send threshold.** An email goes only when a row other than New has something to say; a
  quiet week still sends nothing.
- **Staff tests** choose `auto` (what the person gets) or `every-row`, which lifts the thresholds
  and the cap so every row with data is sent; the plan row stays an admin's.
- **Words live in the mail package** (`digest-week-rows.ts`); the digest sends numbers, names and
  links, never copy, so a copy pass edits one file.

## Consequences

- The coloured "what's new" card, its `digestUpdateSchema` and the five old templates are gone.
  `DigestSend.templateId` rows written before this hold the old ids; nothing reads them back as an
  id to render.
- Evaluator names come from the evaluator type (`ragas/faithfulness` reads "faithfulness"); a
  custom or workflow evaluator reads "custom evaluations", since its type carries an id.
- Out of scope here: an A/B test, tracked redirects (links stay direct), the what's-new editor,
  which scenario failed most, and errors, cost or latency against last week.
