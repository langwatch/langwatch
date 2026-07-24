Feature: Evaluator filter label
  As an operator filtering traces by evaluator
  I want the evaluator filter rows labelled by name, not by type
  So that the limited sidebar width goes to the part that disambiguates

  # A project's evaluators are mostly the same type, so a leading
  # `[workflow]` / `[langevals/llm_category]` pill repeated the same
  # token down the whole list while truncating the names that actually
  # tell evaluators apart.

  @unit
  Scenario: Evaluator facet labels drop the type prefix
    Given the evaluator facet query is built
    Then the projected label is the evaluator name (or id) without a bracketed type prefix
    And the facet value remains the evaluator id so saved queries round-trip

Rule: Inline drilldown toggle on inactive evaluator rows
  An inactive evaluator row (one not yet added to the filter) carrying
  verdict/score aggregates exposes a drilldown the user can expand to
  browse verdicts and score range before committing the filter. The
  expand toggle sits inline at the row's trailing edge — not as a
  full-width strip beneath the row, which read as a stray arrow.

  Scenario: The expand chevron sits at the row's trailing edge
    Given an inactive evaluator row with verdict/score aggregates
    Then a chevron toggle renders inline at the trailing (right) end of the row
    And it is not rendered as a separate full-width row beneath the evaluator

  Scenario: Expanding the drilldown does not toggle the evaluator filter
    Given an inactive evaluator row with verdict/score aggregates
    When the user clicks the trailing chevron
    Then the verdict/score drilldown expands below the row
    And the evaluator is not added to the filter by the click itself

Rule: Score slider is suppressed when the score only mirrors the verdict
  An evaluator that emits a binary 0/1 score alongside its pass/fail
  verdict produced a confusing pairing: the verdict pill rows AND a score
  range slider over [0,1] that says the same thing. The drilldown
  distinguishes a true score range from a binary verdict-mirror so it only
  shows controls that add new filtering power.

  Scenario: Binary 0/1 score hides the score slider
    Given an evaluator drilldown whose scores have at most 2 distinct values within [0,1]
    Then the verdict pill rows are shown
    And no score range slider is shown

  Scenario: A genuine score range keeps the slider
    Given an evaluator drilldown whose scores have more than 2 distinct values
    Then the score range slider is shown alongside any verdict rows

  Scenario: A score outside the 0–1 range keeps the slider
    Given an evaluator drilldown whose score maximum exceeds 1 (e.g. a 0–10 score)
    Then the score range slider is shown

Rule: Emitted label values are clickable filters
  An evaluator that emits labels exposes its top label values as clickable
  rows in the drilldown. Picking one filters traces to that evaluator's
  label, scoped inside the evaluator group — replacing the old static
  "Emits labels" hint the user could not act on.

  @unit
  Scenario: Evaluator label values are filterable
    Given an evaluator drilldown whose aggregates include emitted label values
    Then each label value renders as a clickable row with its count
    And picking a label adds an evaluatorLabel filter scoped to that evaluator
