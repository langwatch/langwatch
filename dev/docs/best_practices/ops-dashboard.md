# Ops surfaces

The pages under `/ops` are read by one audience — an operator, usually mid-incident,
usually looking for the one thing that is wrong. That single fact decides every
convention below. These pages are admin-gated and internal, so they may show
mechanism a customer surface never would; what they may **not** do is spend the
reader's attention on things that are fine.

Behavioural contracts: [specs/ops/ops-dashboard-density.feature](../../../specs/ops/ops-dashboard-density.feature),
[specs/ops/scheduler-operator-control.feature](../../../specs/ops/scheduler-operator-control.feature).
Where the data comes from: [ADR-090](../adr/090-shared-ops-snapshot-single-writer.md).

## The rule

**Space is proportional to trouble.** A quantity that is fine takes one line. A
quantity that is wrong takes as much room as it needs to be understood and acted
on. A page that looks the same whether the platform is healthy or on fire has
failed, however complete it is.

Two corollaries, both learned from the same page:

- **An empty card is worse than no card.** Two full-height cards reading
  "No errors" and "No active anomalies" cost a third of a viewport to say
  nothing. Collapse all-clear states onto one quiet line and let them expand
  in place when they have something to report.
- **A number nobody can act on is an unfinished feature.** "Parked: 129,091" in
  warning orange, with nothing on the page naming a tenant, is not
  observability — it is an alarm with the label torn off. Every headline number
  either links to what produced it or does not earn its place.

## One question, one place

**A question is answered on exactly one surface.** These pages accrete: each
new mechanism arrives with its own card, and the reader is left to know which
mechanism to suspect before they can look. That is backwards — an operator
knows the _symptom_, not the machinery, so the page has to be organised by the
question rather than by what implements it.

Two questions were split across three surfaces each before this rule existed:

```text
"what has permanently stopped?"      "what is switched off?"
  queue dead letters                   parked tenants     (dashboard)
  process-manager outbox               paused schedules   (schedules page)
                                       paused subscribers (subscribers page)
```

Merge the answer, keep the mechanisms distinguishable. A merged panel states
the shared fact once and then keeps one section per mechanism, because the
remedy differs — parking clears itself when capacity frees, a paused subscriber
needs a human. Merging the _tables_ would imply one action fits all three.

Corollaries:

- **A preview belongs with the thing it previews.** Upcoming timed work is a
  read of the calendar, so it lives on the schedules page; replay history lives
  beside the button that starts a replay. On the landing page each was a table
  of things that are fine.
- **Do not mount the same card on two pages.** If a second page needs it, that
  page is the drill-down and the first one gets a summary line — or one of the
  two pages should not exist. `/ops/queues` rendered five cards the dashboard
  already had, component for component, and was retired to a redirect.

## Layout

The dashboard reads top to bottom as: **strip → chart → structure → detail**.

```text
┌ strip ─ one row, every headline number, no wrap ──────────────────┐
├ health ─ one line when clear; expands in place when not ──────────┤
├ paused ─ everything deliberately off; absent when nothing is ─────┤
├ chart ─ shared gridlines, axis-labelled legend ───────────────────┤
├ structure ─ pipeline tree, idle folded away ──────────────────────┤
└ detail ─ groups, clustered; drill-downs ──────────────────────────┘
```

**The strip is one row.** Count the tiles against the grid before adding one: a
grid of ten columns and eleven tiles orphans the eleventh onto a row of its own
and costs a full row of whitespace. Related figures share a tile with their own
labels (memory, engine CPU and client connections are all "Redis"), rather than
each claiming a column.

**Zeros stay.** A zero dead-letter queue is information — it is how the operator
knows the panel is live and the queue is clean. Show it, unstyled. Hiding a
counter when it is zero means its absence and its health look identical.

**Idle structure folds.** The pipeline tree is seeded from a 24-hour registry so
pipelines persist across quiet periods, which is right for continuity and wrong
for a default view: nine of eighteen rows rendering no counts is nine rows of
whitespace between the reader and the two that matter. Fold idle entries behind
a control that states how many there are, de-emphasize them when revealed, and
let one leave the fold the moment work arrives.

**Repetition collapses.** A trace fan-out produces hundreds of rows sharing a
prefix and differing by a trailing index, every other column identical. Cluster
them into one row carrying the member count, the aggregate, and the worst case
across members; expand to members on demand. Two hundred rows that say one thing
should be one row that says it.

## Identifiers

Ksuids are for machines. A row that shows `project_LVYcVYGW1AJqvp2G8vcVd` has
told the operator nothing they can use and taken the width that a name would
have needed.

- Resolve **names** server-side and render those; keep the identifier behind a
  copy affordance.
- When an identifier must be shown, elide it in the **middle** — both ends carry
  the information, and a right-truncated ksuid is indistinguishable from every
  other ksuid with the same prefix.
- Never let an identifier column take width from a column carrying state.

## Charts

- **Dual axes share gridlines.** Deriving each axis maximum independently and
  letting the chart library pick ticks per axis produces two sets of gridlines at
  unrelated positions — the reader cannot tell which line to read against which
  scale. Divide both ranges into the same number of intervals.
- **The legend states the axis.** A flat legend of six series across two axes is
  ambiguous by construction.
- **Reserve width for the longest formatted label.** An axis sized for `500` will
  clip `500.0k`.
- **Check the small series survives.** When one count series is three orders of
  magnitude larger than another, the smaller one flattens onto the axis and
  reads as absent. If a series cannot be seen it should not be in the legend
  claiming it can.

## Copy

[copywriting](./copywriting.md) applies in full — internal surface, same rules.
It is easy to forget here because the reader is technical, but a technical
reader still should not have to expand an abbreviation:

| Don't                 | Do                  |
| --------------------- | ------------------- |
| `Redis conns`         | `Redis connections` |
| `PEND.`               | `Pending`           |
| `OLDEST` with no unit | `Oldest wait`       |

Terms of art that name a real mechanism — dead-letter queue, P50, P99 — stay,
because they are what the thing is called and the operator already knows them.
The test is whether the word is a _term_ or a _truncation_: truncations get
spelled out.

State the meaning of a quantity the operator will not infer. "Parked" means a
tenant is at its in-flight capacity limit, not that anything failed; the label
says so, because an orange six-figure number that means "working as designed"
otherwise reads as an outage. Note that GroupQueue uses "park" for two unrelated
things — tenant soft-cap parking, and the poison-group guard parking a
crash-looping group into the _blocked_ set. On any surface showing both, say
which one you mean.

## Controls

Ops pages default to read-only, and every mutation is an explicit act — never a
side effect of viewing or of navigating.

- Gate mutations on the manage permission; a view-only operator is shown no
  control they cannot use, rather than one that errors when pressed.
- Row actions use [row-actions-overflow-menu](./row-actions-overflow-menu.md);
  tables use [ListTable](./list-table.md).
- **Confirmations name the blast radius in the operator's terms.** These surfaces
  are cross-tenant: the risk is not usually the wrong action, it is the right
  action on the wrong tenant. Name the project, the target and the slot — by
  name, not by identifier the operator cannot verify at a glance.
- **A repair states its own risk.** Clearing a stuck lease can, in the
  pathological case, admit a second worker. Say so in the confirmation and let
  the operator take the trade knowingly.
- **A control that can deliver twice should not exist if it can be avoided.**
  The scheduler's run-now was narrowed to "fire the next slot" rather than
  "re-fire slot S" precisely so the double-delivery case has no control at all.
  Prefer removing the shape over gating it; where it genuinely must exist, gate
  it behind a second, explicit confirmation.
- **A confirmation with an unresolvable name is not a confirmation.** If the
  tenant's name cannot be resolved, withhold the control rather than confirm
  against a ksuid the operator cannot check.
- Audit every mutation and surface recent operator actions on the same page, so
  "why did this happen at 03:14" is answerable where it was caused.
- Failures follow [error-handling](./error-handling.md): a refusal an operator
  can act on gets a stable code and registry copy. "Unknown error" on an ops
  control is a bug in the control.

## Staleness

Where a page serves a shared snapshot rather than a live read (ADR-090), say how
old it is. An operator deciding whether to act needs to know if they are looking
at now or at fifteen seconds ago, and a page that hides that will eventually be
trusted at exactly the wrong moment. Render staleness as status — never as a
toast, and never as an error.
