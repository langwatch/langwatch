Feature: Category evaluators show their label distribution in the list
  As someone running a category evaluator
  I want the online evaluations list to show what the evaluator has been deciding
  So that a month of results is not reported as "No data yet"

  An online evaluation that classifies rather than scores writes a label on
  every result and leaves both the score and the pass flag empty. The
  performance column averaged the score, or the pass flag for guardrails, so a
  category evaluator producing results every day averaged nothing and the row
  read "No data yet". The results were there the whole time; the column had no
  way to read them.

  A category evaluator's result is a distribution, not an average, so the
  column shows one: a strip of the labels it produced over the period, sized by
  share, with the leading label and its movement named next to it.

  Background:
    Given a project with online evaluations

  Rule: The column reads the metric the evaluator actually produces

    @unit
    Scenario: An evaluator that only writes labels is summarized by label share
      Given a monitor whose results carry a label and no score or pass flag
      When the performance for the list is summarized
      Then the monitor is reported as a label distribution
      And the labels are ordered by how often they occurred
      And each label carries its share of the period's results

    @unit
    Scenario: The leading label's movement is measured against the same label
      Given a monitor whose leading label was less common in the previous period
      When the performance for the list is summarized
      Then the reported change is the leading label's own change in share

    @unit
    Scenario: A leading label absent from the previous period counts as no share
      Given a monitor whose leading label did not occur in the previous period
      And the previous period has other results
      When the performance for the list is summarized
      Then the reported change is the full share of the leading label

    @unit
    Scenario: A scoring evaluator is still summarized by score
      Given a monitor whose results carry a score
      When the performance for the list is summarized
      Then the monitor is reported as a score

    @unit
    Scenario: A guardrail is still summarized by pass rate
      Given a guardrail monitor whose results carry a pass flag
      When the performance for the list is summarized
      Then the monitor is reported as a pass rate

    @unit
    Scenario: A monitor with no results at all reports nothing to show
      Given a monitor with no results in either period
      When the performance for the list is summarized
      Then the monitor reports no value

    @unit
    Scenario: Only the most common labels are kept, the rest are grouped
      Given a monitor that produced more distinct labels than the strip can show
      When the performance for the list is summarized
      Then the most common labels are kept
      And the remainder are grouped into a single other entry
      And the shares still add up to the whole period

  Rule: The list renders a label distribution instead of an empty state

    @integration
    Scenario: The row shows the labels instead of an empty state
      Given a row whose performance is a label distribution
      When the online evaluations list is rendered
      Then the row shows a strip of the labels with their shares
      And the row names the leading label and its share
      And the row does not say there is no data

    @integration
    Scenario: The distribution names every label it drew
      Given a row whose performance is a label distribution
      When the online evaluations list is rendered
      Then every label in the distribution is named with its share

    @integration
    Scenario: A scoring row is unchanged
      Given a row whose performance is a score
      When the online evaluations list is rendered
      Then the row shows the score and its trend

    @integration
    Scenario: A row with no results still says there is no data
      Given a row whose performance has no value
      When the online evaluations list is rendered
      Then the row says there is no data yet

  Rule: The label counts come from the evaluation results themselves

    @integration
    Scenario: Label counts are read per day and period
      Given processed results carrying labels across both periods
      When the performance buckets are read
      Then each bucket carries the count of each label produced that day
