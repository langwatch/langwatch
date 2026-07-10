# ADR-043: Automations as orthogonal facets (name / type / subject / cadence / severity / delivery)

- Status: Proposed
- Date: 2026-07-10
- Builds on: ADR-037 (operator surfaces), ADR-040 (webhook channel), ADR-041 (Block Kit templates), ADR-042 (scheduled reports)

## Context

The automation surface grew three "kinds" — **Automation** (act on each matching
trace), **Alert** (fire when a metric crosses a threshold), and **Report** (send
something on a schedule). They were bolted on one at a time, so the config and
the list UI conflate concerns: a single "Conditions" cell mixes *what the thing
is about* with *what makes it run*; the Reports table led with a useless
"Schedule → see Ops" column; the drawer's sections don't map cleanly onto "what
lives where," and it can still say "New report" when the source is trace data.
Users can't tell the pieces apart because the pieces aren't apart.

## Decision

Model every automation as **one object seen through six orthogonal facets**. The
three kinds are not different objects — they are **presets that fix some facets
and hide the rest**.

| Facet | Question it answers | Alert | Report | Automation |
|-------|---------------------|-------|--------|------------|
| **Name** | What is it called? | free text | free text | free text |
| **Type** | Which preset? | Alert | Report | Automation |
| **Subject** ("what") | What data is it about? | a graph + series | a dashboard / graph / trace filter | a trace filter |
| **Cadence** ("when") | What makes it run, and how often? | threshold breach (+ re-notify interval) | a schedule (cron + timezone) | each matching trace (+ digest window / debounce) |
| **Severity** | How urgent when it fires? | info / warning / critical | — | — |
| **Delivery** ("setup") | Where does it go, what does it send? | Slack / email / webhook + template | same | + dataset / annotation queue |

### Consequences for the list UI

- Each column is **one facet, one purpose**. No column mixes subject with timing.
- **Subject leads, cadence follows.** "Watches *error rate*" / "Sends the
  *analytics dashboard*" is the scannable identity; the schedule is secondary
  detail, not the headline. (Directly fixes "when should really be what.")
- The three sections share the **same facet vocabulary** (Name · Subject ·
  Cadence · Delivery · runtime), so moving between them reads as "same shape,
  different preset," not three unrelated tables.

### Consequences for the drawer

The authoring form's sections map 1:1 onto the facets, in this order: **Name →
Type → Subject → Cadence → Severity (alerts) → Delivery**. Picking Type first
fixes which later facets are shown, and the title/labels follow the chosen type
(no more "New report" over a trace source). This is the home for the guided
"templates → text → custom Block Kit" progressive disclosure (ADR-041), which
lives inside **Delivery**.

### Cadence is the growth point

"Cadence" deliberately owns *all* timing — threshold re-notify intervals, digest
bundling windows, trace debounce, and report schedules — so future timing
controls (instant + debounce, quiet hours, per-severity throttling) land in one
named facet instead of being scattered across "conditions" and "schedule."

## Rollout

1. List UI facet vocabulary + sidebar/settings refresh (this slice) — no schema
   change; **Subject** and **Cadence** are derived from existing `actionParams` /
   `filters`.
2. Drawer rebuilt from scratch around the facet order (this PR, following slice).
3. **Severity** as its own slice — additive `severity` on the alert
   `actionParams` (JSON, no migration), threaded into the alert render (color /
   emoji / `@channel`). Sequenced after the template-suite work (ADR-041) since
   it touches the same alert render path.
4. Cadence consolidation — fold re-notify / debounce / quiet-hours into the one
   Cadence facet over subsequent slices.
