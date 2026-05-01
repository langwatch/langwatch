# Evaluations Display — Gherkin Spec
# Covers: evals accordion, eval card layout, run history, card interactions, score types, no-evals state, annotations, feedback, table integration, data gating

# ─────────────────────────────────────────────────────────────────────────────
# EVALS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Evaluations display

Rule: Evals accordion on trace summary tab
  The Evals accordion displays all evaluation results hoisted from all spans
  in the trace, shown only on the Trace Summary tab.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: Evals accordion appears on the Trace Summary tab
    Given the trace has evaluation results
    When the Trace Summary tab is active
    Then the Evals accordion is visible

  Scenario: Evals accordion does not appear on the Span tab
    Given the trace has evaluation results
    When the user switches to a span tab
    Then the Evals accordion is not visible

  Scenario: Accordion header shows count of total eval entries
    Given the trace has 5 runs of "Faithfulness" and 3 runs of "Toxicity"
    When the Trace Summary tab is active
    Then the Evals accordion header reads "Evals (8)"
    # The count reflects every entry in the rich list; runs of the same
    # evaluator are then grouped into a single head card with a "Show N
    # earlier runs" expander.

  Scenario: Evals are hoisted from all spans in the trace
    Given the trace has a "Faithfulness" eval on span "llm.openai.chat"
    And a "Prompt Injection" eval on span "guardrail.pii_check"
    When the user expands the Evals accordion
    Then both eval cards are visible
    And each card shows its originating span name in a "from <spanName>" footer link


# ─────────────────────────────────────────────────────────────────────────────
# EVAL CARD LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Rule: Eval card layout
  Each eval type gets one compact card showing the most recent run, with
  earlier runs collapsed into a "Show N earlier runs" expander beneath it.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Card header shows status badge, name, and score
    Given the trace has a single run of "Topic Adherence" scoring 8.2 out of 10
    Then the card header shows a "PASS" status badge with a tone-coloured background
    And the header shows the eval name "Topic Adherence"
    And the header shows the score "8.2" with sub-label "/ 10"

  Scenario: Numeric score renders a thin score bar below the header
    Given the trace has an eval scoring 8.2 out of 10
    Then a 3px tone-coloured score bar fills proportionally to the score
    # The score bar is suppressed for skipped/error rows (no verdict).

  Scenario: Reasoning panel renders when reasoning text is present
    Given the trace has an eval with reasoning text
    Then a reasoning panel below the score bar shows the full reasoning text wrapped (no character truncation)
    # Reasoning is not collapsed to a fixed character length; long text wraps
    # naturally inside the card's reasoning panel.

  Scenario: Span origin is shown in the card footer
    Given the trace has an eval originating from span "llm.openai.chat"
    Then the card footer shows a "from <spanName>" clickable link
    And clicking the span name selects that span via onSelectSpan

  Scenario: Show details reveals additional context when present
    Given an eval card has any of: inputs, label, error message, error IDs, or stacktrace
    When the user clicks "Show details"
    Then a details panel reveals the available rows (Label, Error, IDs, Stacktrace, Inputs)

  Scenario: Show details is hidden when no extra context exists
    Given an eval card has only name, score, and reasoning
    Then no "Show details" toggle is rendered

  Scenario: Footer shows execution metadata when available
    Given the trace has an eval with executionTime and evalCost
    Then the card footer renders the formatted duration and cost as monospace 2xs text


# ─────────────────────────────────────────────────────────────────────────────
# RUN HISTORY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Eval run history
  When the same evaluator runs multiple times on a trace, runs are grouped
  by evaluatorId. The newest run is the head card; older runs collapse
  into a "Show N earlier runs" expander beneath it.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer
    And the Evals accordion is expanded

  Scenario: Single run shows no history indicator
    Given the trace has exactly one run of "Topic Adherence"
    Then the eval card shows the score with no sparkline and no history expander

  Scenario: Multiple runs of a numeric eval show a sparkline in the header
    Given the trace has 5 runs of "Faithfulness" with scores 7.2, 7.8, 3.2, 8.4, and 9.1
    Then the head card shows the most recent score 9.1
    And a mini SVG polyline sparkline is visible inline in the header
    And a "(5)" count appears after the sparkline

  Scenario: Sparkline caps numeric runs at 8
    Given the trace has 12 runs of a numeric eval
    Then the sparkline draws only the most recent 8 runs
    And the count text reflects the full run total

  Scenario: Multiple runs of a pass/fail eval show colored dots
    Given the trace has 4 runs of "Prompt Injection" with results pass, pass, fail, pass
    Then the eval card shows colored dots: green, green, red, green
    And the most recent result is displayed as the card score
    And a "(4)" count appears after the dots

  Scenario: Earlier runs collapse into a stacked expander beneath the head card
    Given the trace has 5 runs of "Faithfulness"
    Then the head card shows the most recent run
    And below it a "Show 4 earlier runs" toggle is visible
    When the user clicks "Show 4 earlier runs"
    Then each earlier run renders as a row with a status dot, status label, score, and timestamp
    And each earlier run shows the originating span name with a "jump to span" affordance when spanId is present

  Scenario: Earlier-run rows do not show reasoning inline
    Given the trace has multiple runs with reasoning
    When the user expands the earlier-runs stack
    Then individual rows show only score, status, time, and span — not reasoning

  @planned
  Scenario: Sparkline tooltip shows per-run detail
    # Not yet implemented as of 2026-05-01 — RunHistorySparkline does not
    # render a hover tooltip; it's a static SVG polyline.
    Given the trace has multiple runs of a numeric eval
    When the user hovers over the sparkline
    Then a tooltip shows exact scores and timestamps for each run

  @planned
  Scenario: Run timeline shows "latest" / "first run" labels
    # Not yet implemented as of 2026-05-01 — EvalHistoryStack rows show
    # status, score, timestamp, and span name only; no first/latest tags.
    Given the trace has 5 runs of "Faithfulness"
    When the user expands the earlier-runs stack
    Then the most recent run is labeled "latest" and the oldest is labeled "first run"


# ─────────────────────────────────────────────────────────────────────────────
# EVAL CARD INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Eval card interactions
  Eval cards provide clickable links to navigate to source spans.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Clicking span origin selects that span via onSelectSpan
    When the user clicks the span origin link in an eval card footer
    Then onSelectSpan is invoked with the eval's spanId

  Scenario: Earlier-run rows can jump to their source span
    Given the user has expanded the earlier-runs stack on an eval
    And an earlier run carries a spanId
    When the user clicks the truncated spanId link on that row
    Then onSelectSpan is invoked with that run's spanId

  @planned
  Scenario: Hovering span origin highlights the span in the visualization
    # Not yet implemented as of 2026-05-01 — span-origin link is not wired
    # to the visualization highlight state.
    When the user hovers over the span origin link
    Then the corresponding span is highlighted in the trace visualization

  @planned
  Scenario: "Edit evaluator" / "Filter by this eval" actions
    # Not yet implemented as of 2026-05-01 — EvalCard does not render Edit
    # evaluator or Filter-by-eval action buttons. Only Show/Hide details.
    Given an eval card has expandable details
    When the user clicks "Show details"
    Then "Edit evaluator" and "Filter by this eval" buttons appear


# ─────────────────────────────────────────────────────────────────────────────
# COLOR CODING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Eval status colour coding
  Eval cards use a status-tone palette with dedicated badges, score colours,
  and score-bar fills. The mapping is driven by the evaluation status and
  passed flag, not by absolute score thresholds.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Pass status uses the green tone
    Given the trace has a processed eval with passed=true
    Then the card header shows a "PASS" badge with green tone
    And the score and (where applicable) score bar render in green

  Scenario: Fail status uses the red tone
    Given the trace has a processed eval with passed=false
    Then the card header shows a "FAIL" badge with red tone

  Scenario: Skipped status uses the muted tone with a dedicated icon
    Given the trace has an eval with status "skipped"
    Then the card header shows a "SKIPPED" badge with the LuCircleSlash icon
    And no numeric score, sub-label, or score bar is rendered

  Scenario: Errored status uses the orange tone with an alert icon
    Given the trace has an eval with status "error"
    Then the card header shows an "ERROR" badge with the LuCircleAlert icon
    And the reasoning panel renders with the error tone background

  Scenario: Warning status uses the yellow tone
    Given the trace has an eval with status "warning"
    Then the card header shows a "WARN" badge with yellow tone

  @planned
  Scenario: Card-edge accent border matching status colour
    # Not yet implemented as of 2026-05-01 — cards render a uniform
    # `border` colour. There is no accent left border on the card itself.
    Given the trace has an eval scoring 8.0 out of 10
    Then the eval card has a subtle left accent border matching the status tone


# ─────────────────────────────────────────────────────────────────────────────
# SCORE TYPES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Eval score type display
  Evaluations adapt their score rendering based on the inferred score type.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Numeric scores >1 display with "/ 10" sub-label
    Given the trace has a "Topic Adherence" eval with a numeric score of 8.2
    Then the score header shows "8.2" with sub-label "/ 10"

  Scenario: Numeric scores 0-1 display with "/ 1.00" sub-label
    Given the trace has a "Similarity" eval with a numeric score of 0.82
    Then the score header shows "0.82" with sub-label "/ 1.00"

  Scenario: Boolean pass result displays as "PASS"
    Given the trace has an eval with scoreType "boolean" and score=true
    Then the score label reads "PASS" with no sub-label

  Scenario: Boolean fail result displays as "FAIL"
    Given the trace has an eval with scoreType "boolean" and score=false
    Then the score label reads "FAIL" with no sub-label

  Scenario: Categorical score displays the raw label
    Given the trace has an eval with scoreType "categorical" and score "Positive"
    Then the score label renders as "Positive"

  Scenario: All status types get a status badge
    Given the trace has evals across statuses (pass, fail, warning, skipped, error)
    Then each card renders a tone-coloured status badge (PASS / FAIL / WARN / SKIPPED / ERROR) regardless of score type


# ─────────────────────────────────────────────────────────────────────────────
# NO EVALS STATE
# ─────────────────────────────────────────────────────────────────────────────

Rule: No evaluations state
  When a trace has no evaluation results, EvalsList renders a compact
  empty state in place of cards, and the Evals section auto-collapses
  via the auto-open content map.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with no evaluation results

  Scenario: Empty state message is shown when no evals exist
    When the Trace Summary tab is active
    And the Evals accordion is expanded
    Then the text "No evaluations yet" is visible

  Scenario: Empty state includes a description of evaluators
    When the Evals accordion is expanded
    Then the description reads "Set up evaluators to automatically score traces on quality, safety, and accuracy."

  Scenario: Empty state includes a docs link
    When the Evals accordion is expanded
    Then a "Learn more" button links to https://docs.langwatch.ai/evaluations/overview in a new tab

  Scenario: Accordion section is rendered but starts collapsed when empty
    When the Trace Summary tab is active
    Then the Evals section is present in the accordion list
    And it is marked as `empty` (no content auto-opened it on this trace)


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Annotations live in the Conversation view, not the trace summary
  Annotations surface inline on each turn in ConversationView (badges,
  popover, action row) and via the Conversation view's "Annotations"
  rollup mode. The Trace Summary tab does NOT render an Annotations
  accordion. See `annotations.feature` for the per-turn behaviour.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: Trace Summary tab does not render an Annotations accordion
    Given the trace has annotations
    When the Trace Summary tab is active
    Then no "Annotations" section appears in the trace summary accordion list

  Scenario: Annotations are surfaced on the conversation turn separator
    Given the trace's turn has at least one annotation
    When the user views the Conversation tab
    Then the turn separator renders a TurnAnnotationBadges popover trigger with the annotation count

  @planned
  Scenario: Trace-level Annotations summary section
    # Not yet implemented as of 2026-05-01 — TraceSummaryAccordions builds
    # ["io"|"exceptions","attributes","evals","events"] only. There is no
    # Annotations section on the trace summary tab.
    Given the trace has 1 annotation
    When the Trace Summary tab is active
    Then a dedicated Annotations section is visible


# ─────────────────────────────────────────────────────────────────────────────
# FEEDBACK AS EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Feedback is displayed as events
  Feedback (thumbs up/down, satisfaction scores) is not a special UI section.
  It appears in the Events accordion alongside other event types.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: Feedback appears in the Events accordion
    Given the trace has a "user.feedback" event with vote "up"
    When the user expands the Events accordion
    Then the feedback event is visible alongside other events

  Scenario: Feedback is not a first-class field on the trace summary
    Given the trace has feedback events
    When the Trace Summary tab is active
    Then there is no dedicated feedback section or field on the summary

  Scenario: Feedback can be filtered via the event facet
    When the user applies the filter "event:user.feedback"
    Then only traces with feedback events are shown
    # `event` is a real facet field exposed via `query-language/metadata`
    # and the "Trace" facet group in the sidebar.

  @planned
  Scenario: `@has:feedback` shorthand
    # Not yet implemented as of 2026-05-01 — the query language supports
    # `has:eval`, `has:user`, `has:conversation`, etc., but no `has:feedback`
    # shorthand is registered.
    When the user applies the filter "has:feedback"
    Then only traces with feedback events are shown


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: INDIVIDUAL EVAL COLUMNS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Individual eval columns in trace table
  Per-evaluator column defs are dynamically derived (`makeEvalCellDef`) from
  the unique evaluators observed across the visible rows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible

  Scenario: Eval columns are dynamically derived from visible rows
    When the trace table loads
    Then a `eval:<evaluatorId>` column definition is registered for each unique evaluator across visible rows

  Scenario: Individual eval column renders score with status colour dot
    Given a trace has a "Faithfulness" eval with a numeric score of 8.2
    Then the cell shows a colour dot tinted by `evalChipColor` and the formatted score "8.2"

  Scenario: Individual eval column renders Pass / Fail when score is unavailable
    Given a trace has a "Prompt Injection" eval with passed=false and no numeric score
    Then the cell shows a red dot and the text "Fail"

  Scenario: Individual eval column shows a dash when the row has no run
    Given a trace has no run of the column's evaluator
    Then the cell renders an em-dash placeholder

  @planned
  Scenario: Sorting by an individual eval column
    # Not yet implemented as of 2026-05-01 — the dynamic eval column has no
    # sort plumbing; column headers don't expose sort.
    Given the "Faithfulness" column is enabled
    When the user sorts by "Faithfulness" ascending
    Then the traces are ordered by lowest faithfulness score first

  @planned
  Scenario: Eval shown as individual column is excluded from summary badges
    # Not yet implemented as of 2026-05-01 — `EvaluationsCell` renders all
    # latest evaluators regardless of which individual columns are enabled.
    Given the "Faithfulness" column is enabled
    And the evals summary column is also enabled
    Then the evals summary column does not include a "Faithfulness" badge


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: EVALS SUMMARY COLUMN
# ─────────────────────────────────────────────────────────────────────────────

Rule: Evals summary column in trace table
  A single "Evals" column renders inline `EvalChip` badges for the latest
  run of each evaluator on the trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible
    And the evals summary column is enabled via column selector

  Scenario: Summary column shows EvalChip badges for each evaluator's latest run
    Given a trace has "Faithfulness" scoring 9.1 and "Toxicity" scoring 1.2
    Then the evals summary cell shows two `EvalChip` badges deduped to the latest run per evaluator

  Scenario: Summary column caps inline badges at 9 and shows "+N more" overflow
    Given a trace has more than 9 deduped evals
    Then the cell shows the first 9 badges followed by a "+N more" overflow pill

  Scenario: Empty cell renders an em-dash
    Given a trace has no evaluations
    Then the evals summary cell renders an em-dash placeholder

  @planned
  Scenario: Hovering overflow indicator lists all evals
    # Not yet implemented as of 2026-05-01 — `MoreEvalsPill` is a static
    # visual count, not a tooltip-bearing trigger.
    When the user hovers over the "+N more" indicator
    Then a tooltip lists all evaluation results

  @planned
  Scenario: Clicking a badge opens a popover with detail
    # Not yet implemented as of 2026-05-01 — `EvalChip` renders no popover
    # on click; full detail lives in the drawer's Evals accordion.
    When the user clicks an eval badge in the summary cell
    Then a popover shows the score, status, and reasoning for that eval


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: EVENTS SUMMARY COLUMN
# ─────────────────────────────────────────────────────────────────────────────

Rule: Events summary column in trace table
  The Events column renders an `EventBadge` per event on the trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible
    And the events summary column is enabled via column selector

  Scenario: Events column renders one badge per event
    Given a trace has 3 events
    Then the events summary cell shows 3 inline EventBadge components

  Scenario: Events column shows dash when no events
    Given a trace has no events
    Then the events summary cell renders an em-dash placeholder

  @planned
  Scenario: Aggregate event count + warning indicator
    # Not yet implemented as of 2026-05-01 — the cell renders a list of
    # badges; there is no aggregate count number or warning glyph.
    Given a trace has 3 events including an exception
    Then the events summary cell shows "3" with a warning indicator

  @planned
  Scenario: Compact exception-type badge
    # Not yet implemented as of 2026-05-01 — exceptions render as a generic
    # EventBadge; there is no per-exception-type compact badge.
    Given a trace has a "RateLimitError" exception
    Then the events summary cell shows a compact badge with the exception type


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating for evaluations
  The UI adapts gracefully based on available evaluation data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: No evals shows the EvalsList empty state
    Given the trace has no evaluations
    When the Trace Summary tab is active
    And the user expands the Evals accordion
    Then the "No evaluations yet" message and "Learn more" docs link are shown
    And the Evals section auto-collapses by default (no content gates auto-open)

  Scenario: Evals without reasoning render the header without the reasoning panel
    Given the trace has an eval with a score but no reasoning text
    When the Evals accordion is expanded
    Then the card renders only the header (and score bar for numeric)
    And no reasoning panel is displayed

  Scenario: Multiple eval runs show the most recent as the head card
    Given the trace has 3 runs of "Faithfulness" with the most recent scoring 9.1
    When the Evals accordion is expanded
    Then the "Faithfulness" head card shows score 9.1
    And a sparkline + "(3)" count is visible in the header

  Scenario: Prior runs are accessible via the earlier-runs expander
    Given the trace has multiple runs of "Faithfulness"
    When the user clicks "Show N earlier runs" beneath the head card
    Then each prior run is rendered with status, score, time, and span jump affordance
