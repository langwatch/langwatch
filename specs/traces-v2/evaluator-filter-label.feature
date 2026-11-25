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

Rule: Picking a row opens its drilldown
  The trailing chevron was the only way in, and it reads as decoration:
  operators clicked the evaluator itself, got the filter, and never learned
  that pass/fail lived one level down. So the row's own click opens the
  drilldown as well as applying the filter — the sub-options are visible the
  moment the filter lands, without a second, unadvertised gesture. The
  behaviour belongs to the section, so event rows and their metric values
  gain it on the same terms.

  @integration
  Scenario: Clicking an evaluator row opens its verdict drilldown
    Given an inactive evaluator row with verdict/score aggregates
    When the user clicks the row itself
    Then the verdict/score drilldown expands below the row
    And the evaluator is added to the filter

  # Open-ness follows the filter rather than latching on click. A latch would
  # leave a row displaying verdict controls for a filter it no longer carries,
  # and it would disagree with the pinned copy of the same row, which shows its
  # drilldown for as long as the filter stands.
  @integration
  Scenario: The drilldown stays open while the row is excluded
    Given an evaluator row whose drilldown was opened by clicking the row
    When the user clicks the row a second time to exclude the evaluator
    Then the drilldown stays open
    And the evaluator is excluded from the filter

  @integration
  Scenario: Dropping the filter closes the drilldown
    Given an evaluator row whose drilldown was opened by clicking the row
    When the evaluator stops contributing to the filter
    Then the drilldown collapses with it

  # The filter can be dropped from outside the row entirely — the query bar,
  # the pinned copy of the row, a saved view. The drilldown must not outlive it.
  @integration
  Scenario: Clearing the filter elsewhere closes the drilldown
    Given an evaluator row whose drilldown was opened by clicking the row
    When the evaluator filter is cleared without touching the row
    Then the drilldown collapses with it

  @integration
  Scenario: A row carrying no drilldown filters exactly as before
    Given a facet section whose rows have no sub-options
    When the user clicks a row
    Then only the filter is applied

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

Rule: The Evaluator Verdict facet reads like the drilldown
  The standalone Evaluator Verdict section sits directly above the evaluator
  drilldown, showing the same words — Pass, Fail, Error. It had no colour or
  order rules of its own, so it fell through to the generic string hash and
  the generic count sort: the verdicts drew arbitrary palette slots, and Fail
  sat above Pass whenever failures happened to outnumber passes. Two rows
  swapping places between projects, in colours that disagreed with the panel
  underneath them.

  @unit
  Scenario: Verdicts carry the drilldown's traffic light
    Given the Evaluator Verdict facet
    Then pass renders green, fail renders red and error renders yellow
    And skipped and unknown stay neutral grey
    And the palette renders at full strength rather than dimmed

  @unit
  Scenario: Verdicts read pass, fail, error regardless of counts
    Given evaluator verdict values arriving in count order with fail ahead of pass
    Then the section lists pass, then fail, then error
    And verdicts outside that order trail behind in the order they arrived

  @unit
  Scenario: Ordering the facet does not invent verdict rows
    Given a project whose evaluators have only ever emitted pass and fail
    Then the section lists only pass and fail
    And no zero-count error row is added to an already dense section
