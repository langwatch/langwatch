# Evaluations Display — Gherkin Spec
# Based on PRD-009: Evaluations Display
# Covers: evals accordion, eval card layout, run history, card interactions, score types, no-evals state, annotations, feedback, table integration, data gating

# ─────────────────────────────────────────────────────────────────────────────
# EVALS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Evals accordion on trace summary tab
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

  Scenario: Accordion header shows count of distinct eval types
    Given the trace has 5 runs of "Faithfulness" and 3 runs of "Toxicity"
    When the Trace Summary tab is active
    Then the Evals accordion header reads "Evals (2)"

  Scenario: Evals are hoisted from all spans in the trace
    Given the trace has a "Faithfulness" eval on span "llm.openai.chat"
    And a "Prompt Injection" eval on span "guardrail.pii_check"
    When the user expands the Evals accordion
    Then both eval cards are visible
    And each card shows its originating span name


# ─────────────────────────────────────────────────────────────────────────────
# EVAL CARD LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Eval card layout
  Each eval type gets one compact card showing the most recent run.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Collapsed card shows two lines
    Given the trace has a single run of "Topic Adherence" scoring 8.2 out of 10
    Then the eval card is two lines tall
    And line 1 shows a color dot, "Topic Adherence", a timestamp offset, "8.2/10", the span origin, and an expand chevron
    And line 2 shows a truncated reasoning snippet

  Scenario: Color dot replaces the score bar
    Given the trace has an eval scoring 8.2 out of 10
    Then a green dot appears next to the eval name
    And no score bar is rendered

  Scenario: Reasoning is truncated to one line when collapsed
    Given the trace has an eval with reasoning longer than 60 characters
    Then the reasoning is truncated to approximately 60 characters on one line

  Scenario: Span origin is inline on line 1
    Given the trace has an eval originating from span "llm.openai.chat"
    Then the span origin appears inline on line 1 as a truncated span name
    And the span origin is clickable

  Scenario: Expanding a card reveals full detail
    When the user clicks the expand chevron on an eval card
    Then the full reasoning text is visible
    And processing metadata is shown including duration and cost
    And the full span origin with ID is shown
    And action links "Edit evaluator" and "Filter by this eval" are visible

  Scenario: Collapsing an expanded card returns to two lines
    Given an eval card is expanded
    When the user clicks the collapse chevron
    Then the card returns to two lines


# ─────────────────────────────────────────────────────────────────────────────
# RUN HISTORY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Eval run history
  When the same eval type runs multiple times on a trace, the card shows
  the most recent run with inline run history.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer
    And the Evals accordion is expanded

  Scenario: Single run shows no history indicator
    Given the trace has exactly one run of "Topic Adherence"
    Then the eval card shows the score with no history indicator

  Scenario: Multiple runs of a numeric eval show a sparkline
    Given the trace has 5 runs of "Faithfulness" with scores 7.2, 7.8, 3.2, 8.4, and 9.1
    Then the eval card shows the most recent score 9.1
    And a mini sparkline with 5 data points is visible inline on line 1
    And a "(5)" count appears after the sparkline

  Scenario: Sparkline shows at most 5 data points
    Given the trace has 8 runs of a numeric eval
    Then the sparkline shows only the most recent 5 runs

  Scenario: Multiple runs of a pass/fail eval show colored dots
    Given the trace has 4 runs of "Prompt Injection" with results pass, pass, fail, pass
    Then the eval card shows colored dots: green, green, red, green
    And the most recent result is displayed as the card score
    And a "(4)" count appears after the dots

  Scenario: Pass/fail dots show at most 8 entries
    Given the trace has 12 runs of a pass/fail eval
    Then the dot indicator shows only the most recent 8 runs

  Scenario: Hovering the sparkline shows exact scores and timestamps
    Given the trace has multiple runs of a numeric eval
    When the user hovers over the sparkline
    Then a tooltip shows exact scores and timestamps for each run

  Scenario: Clicking the sparkline opens expanded run timeline
    Given the trace has multiple runs of "Faithfulness"
    When the user clicks the sparkline
    Then the card expands to show the full run history
    And each historical run shows a score with colored dot
    And each historical run shows a timestamp offset
    And each historical run shows what triggered the re-evaluation

  Scenario: Run timeline shows labels for first and latest runs
    Given the trace has 5 runs of "Faithfulness"
    When the run history is expanded
    Then the most recent run is labeled "latest"
    And the oldest run is labeled "first run"

  Scenario: Run timeline shows FAIL label on failed runs
    Given the trace has a run history with a failed run
    When the run history is expanded
    Then the failed run shows a "FAIL" label

  Scenario: Run timeline shows reasoning collapsed by default
    Given the trace has multiple runs with reasoning
    When the run history is expanded
    Then individual run reasoning is collapsed by default
    And each run can be expanded individually to show reasoning


# ─────────────────────────────────────────────────────────────────────────────
# EVAL CARD INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Eval card interactions
  Eval cards provide clickable links and visual feedback for navigation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Clicking span origin opens the span tab
    When the user clicks the span origin link on an eval card
    Then that span's tab opens in the trace drawer

  Scenario: Hovering span origin highlights the span in the visualization
    When the user hovers over the span origin link
    Then the corresponding span is highlighted in the trace visualization

  Scenario: Edit evaluator link opens evaluator config
    Given an eval card is expanded
    When the user clicks "Edit evaluator"
    Then the evaluator configuration page opens in a new context

  Scenario: Filter by this eval link applies search filter
    Given an eval card for "Topic Adherence" is expanded
    When the user clicks "Filter by this eval"
    Then the search bar updates with the filter "@has:eval:Topic Adherence"


# ─────────────────────────────────────────────────────────────────────────────
# COLOR CODING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Eval score color coding
  Eval cards use consistent color coding for scores.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: High score shows green dot
    Given the trace has an eval scoring 8.0 out of 10
    Then the eval card shows a green dot

  Scenario: Medium score shows yellow dot
    Given the trace has an eval scoring 5.5 out of 10
    Then the eval card shows a yellow dot

  Scenario: Low score shows red dot
    Given the trace has an eval scoring 2.0 out of 10
    Then the eval card shows a red dot

  Scenario: Pass result shows green dot
    Given the trace has a pass/fail eval with result "PASS"
    Then the eval card shows a green dot

  Scenario: Fail result shows red dot
    Given the trace has a pass/fail eval with result "FAIL"
    Then the eval card shows a red dot

  Scenario: Card has a subtle left border matching score color
    Given the trace has an eval scoring 8.0 out of 10
    Then the eval card has a subtle 2px left border in green at reduced opacity

  Scenario: Failed eval border does not visually dominate
    Given the trace has a failed eval
    Then the eval card has a red left border at reduced opacity


# ─────────────────────────────────────────────────────────────────────────────
# SCORE TYPES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Eval score type display
  Evaluations adapt their display based on score format.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with evaluation results
    And the Evals accordion is expanded

  Scenario: Numeric 0-10 score displays as fraction
    Given the trace has a "Topic Adherence" eval with a numeric 0-10 score of 8.2
    Then the score displays as "8.2 / 10"

  Scenario: Numeric 0-1 score displays as decimal
    Given the trace has a "Similarity" eval with a numeric 0-1 score of 0.82
    Then the score displays as "0.82"

  Scenario: Boolean score displays as pass or fail badge
    Given the trace has a "Prompt Injection" eval with a boolean pass result
    Then the score displays as a "PASS" badge

  Scenario: Boolean fail displays as fail badge
    Given the trace has a "Prompt Injection" eval with a boolean fail result
    Then the score displays as a "FAIL" badge

  Scenario: Categorical score displays as text label
    Given the trace has a "Sentiment" eval with a categorical result "Positive"
    Then the score displays as the text label "Positive"

  Scenario: All score types get a color-coded indicator
    Given the trace has evals of different score types
    Then each eval card shows a color-coded dot or badge regardless of score type


# ─────────────────────────────────────────────────────────────────────────────
# NO EVALS STATE
# ─────────────────────────────────────────────────────────────────────────────

Feature: No evaluations state
  When a trace has no evaluation results, the accordion shows a helpful
  empty state with a link to set up evaluations.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer with no evaluation results

  Scenario: Empty state message is shown when no evals exist
    When the Trace Summary tab is active
    Then the text "No evaluations for this trace" is visible

  Scenario: Empty state includes a description of evaluations
    When the Trace Summary tab is active
    Then the description reads "Evaluations automatically score your traces on quality, safety, and accuracy."

  Scenario: Empty state includes a setup link
    When the Trace Summary tab is active
    Then a "Set up evaluations" link is visible
    And clicking it navigates to the evaluation setup page

  Scenario: Accordion is still visible even with no evals
    When the Trace Summary tab is active
    Then the Evals accordion area is visible and not hidden


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Annotations display
  Annotations are human-provided corrections or notes on a trace,
  shown below eval cards.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: Annotations section appears when annotations exist
    Given the trace has 1 annotation
    When the Trace Summary tab is active
    Then the Annotations section is visible below the eval cards
    And the section header shows "ANNOTATIONS" with "1 total"

  Scenario: Annotation card shows author and date
    Given the trace has an annotation by "sarah" added on "2026-04-20"
    Then the annotation card shows "by @sarah"
    And the annotation card shows "Added 2026-04-20"

  Scenario: Annotation card shows original and corrected output
    Given the trace has an annotation with a corrected output
    Then the annotation card shows the original output
    And the annotation card shows the corrected output

  Scenario: Annotation card shows free-text note
    Given the trace has an annotation with a note "Policy changed in March 2026"
    Then the annotation card shows the note text

  Scenario: Annotations are read-only in Phase 1
    Given the trace has annotations
    Then no edit or delete controls are visible on annotation cards

  Scenario: Annotations section is hidden when no annotations exist
    Given the trace has no annotations
    When the Trace Summary tab is active
    Then the Annotations section is not visible


# ─────────────────────────────────────────────────────────────────────────────
# FEEDBACK AS EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Feedback is displayed as events
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

  Scenario: Feedback can be filtered like any other event
    When the user applies the filter "@event:user.feedback"
    Then only traces with feedback events are shown

  Scenario: Feedback can be filtered with has shorthand
    When the user applies the filter "@has:feedback"
    Then only traces with feedback events are shown


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: INDIVIDUAL EVAL COLUMNS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Individual eval columns in trace table
  Users can add individual columns per eval type to the trace table.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible

  Scenario: Eval columns are hidden by default
    When the trace table loads
    Then no individual eval columns are visible

  Scenario: Adding an eval column via column selector
    When the user opens the column selector
    And selects the "Faithfulness" eval column
    Then a "Faithfulness" column appears in the trace table

  Scenario: Individual eval column shows compact score
    Given the "Faithfulness" column is enabled
    And a trace has a Faithfulness score of 8.2
    Then the cell shows a green dot and "8.2"

  Scenario: Individual eval column shows fail indicator
    Given the "Prompt Injection" column is enabled
    And a trace has a failed Prompt Injection eval
    Then the cell shows a red dot and a fail indicator

  Scenario: Individual eval columns are sortable
    Given the "Faithfulness" column is enabled
    When the user sorts by "Faithfulness" ascending
    Then the traces are ordered by lowest faithfulness score first

  Scenario: Eval shown as individual column is excluded from summary badges
    Given the "Faithfulness" column is enabled
    And the evals summary column is also enabled
    Then the evals summary column does not include a "Faithfulness" badge


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: EVALS SUMMARY COLUMN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Evals summary column in trace table
  A single column shows compact inline badges for all evals on a trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible
    And the evals summary column is enabled via column selector

  Scenario: Summary column shows badges for eval results
    Given a trace has "Faithfulness" scoring 9.1 and "Toxicity" scoring 1.2
    Then the evals summary cell shows colored badges with short names and scores

  Scenario: Summary column shows at most 2-3 visible badges
    Given a trace has 5 eval results
    Then the evals summary cell shows 2 to 3 badges based on column width
    And a "+N" overflow indicator for the remaining evals

  Scenario: Hovering overflow indicator lists all evals
    Given a trace has more evals than fit in the summary cell
    When the user hovers over the "+N" indicator
    Then a tooltip lists all evaluation results

  Scenario: Clicking a badge opens a popover with detail
    Given the evals summary cell shows a "Faithfulness" badge
    When the user clicks the badge
    Then a popover shows the score, status, and reasoning for that eval


# ─────────────────────────────────────────────────────────────────────────────
# TABLE INTEGRATION: EVENTS SUMMARY COLUMN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Events summary column in trace table
  A single column shows event count and exception indicator.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible
    And the events summary column is enabled via column selector

  Scenario: Events column shows event count
    Given a trace has 3 events
    Then the events summary cell shows "3"

  Scenario: Events column shows exception indicator
    Given a trace has 3 events including an exception
    Then the events summary cell shows "3" with a warning indicator

  Scenario: Events column shows dash when no events
    Given a trace has no events
    Then the events summary cell shows a dash

  Scenario: Exception type badge shows when enabled
    Given a trace has a "RateLimitError" exception
    Then the events summary cell shows a compact badge with the exception type


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Data gating for evaluations
  The UI adapts gracefully based on available evaluation data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user opens a trace drawer

  Scenario: No evals and no annotations shows empty state with setup link
    Given the trace has no evaluations and no annotations
    When the Trace Summary tab is active
    Then the "No evaluations for this trace" message is shown with a setup link
    And the Evals accordion area is not hidden

  Scenario: Evals without reasoning show name and score only
    Given the trace has an eval with a score but no reasoning text
    When the Evals accordion is expanded
    Then the eval card shows the eval name and score
    And no reasoning line is displayed

  Scenario: Multiple eval runs show only most recent result
    Given the trace has 3 runs of "Faithfulness" with the most recent scoring 9.1
    When the Evals accordion is expanded
    Then the "Faithfulness" card shows score 9.1
    And a run history indicator is visible

  Scenario: Prior runs are accessible via collapsible history
    Given the trace has multiple runs of "Faithfulness"
    When the user expands the run history
    Then all prior runs are listed with scores and timestamps
