# visualdiff's pixel diff flags every screen that moved; most moves are harmless.
# The judge asks a vision model whether the branch screenshot shows a real
# regression against main. Its verdicts must be stable and cheap, so the logic
# is pinned with a fake judge. Bound by vitest in tools/visualdiff/runner.

Feature: visualdiff judge keeps only agreed regressions between main and branch screenshots

  Rule: The judge runs only when the plan asks for it

    @unit
    Scenario: A plan without a judge never asks the model
      Given a plan that does not set judge
      When the runner reads it
      Then no screenshot pair is judged

  Rule: Only flagged pairs are judged

    @unit
    Scenario: A pair the pixel diff did not flag is skipped
      Given a main and branch screenshot pair that differs below the noise ratio
      When the judge sees the pair
      Then the model is not asked

  Rule: A flagged pair is judged a second time and only agreed regressions stand

    @unit
    Scenario: A regression the second judgement does not repeat is dropped
      Given the first judgement names two regressions on a flagged pair
      And the second judgement names only one of them
      When the judge finishes the pair
      Then only the regression both judgements named is kept

    @unit
    Scenario: A harmless difference is judged once
      Given the first judgement names no regression
      When the judge finishes the pair
      Then the model was asked once

  Rule: A pair already judged is answered from the cache

    @unit
    Scenario: The same screenshot pair is not judged again in a later run
      Given a screenshot pair whose verdict is in the cache
      When a later run judges the same pair
      Then the model is not asked
      And the cached regressions are reported

  Rule: Every run records what judging cost

    @unit
    Scenario: The ledger counts calls, tokens and dollars
      Given a flagged pair judged twice
      When the ledger is read
      Then it records both calls, their tokens and their cost in dollars

    @unit
    Scenario: A judge that fails keeps no verdict and is counted
      Given a judge that answers with an error
      When a flagged pair is judged
      Then no regression is reported and nothing is cached
      And the ledger counts the failure with its first message
