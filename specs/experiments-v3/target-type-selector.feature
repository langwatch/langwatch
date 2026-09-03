Feature: Picking what to add to an evaluation
  As someone building an evaluation
  I want to choose what the next column evaluates
  So that I can add a prompt, an agent, a comparison or an evaluator to the run

  # The picker is the one affordance that adds anything to an evaluation: the
  # "+" on the Evaluations table and the Run Evaluation button both open it.
  # It is URL-addressed, so a link reopens it on the run it was opened from.
  #
  # It never creates anything itself. Each card hands off to the drawer that
  # lists what you already have, and that list is where "create a new one"
  # lives. A comparison is a saved evaluator like any other, which is why the
  # comparison card leads to the same list-then-create flow rather than
  # straight into a form.
  #
  # Recovered with the drawer in the ownerless-surfaces sweep: the component
  # was deleted with `platform/app` while both openers kept writing the
  # address, so the affordance opened nothing at all.

  Background:
    Given I am building an evaluation in the workbench

  @integration
  Scenario: The picker offers every kind of column an evaluation can hold
    When I open the picker
    Then I am offered a prompt, an agent, a comparison and an evaluator
    And each is described by what it evaluates rather than by how it is built

  @integration
  Scenario: Choosing a prompt goes to the prompt library
    When I open the picker
    And I choose the prompt card
    Then the prompt library opens in place of the picker
    # In place of, not on top of: the library replaces the picker in history,
    # so closing the library returns to the run rather than to the picker.

  @integration
  Scenario: Choosing an agent goes to the agent list
    When I open the picker
    And I choose the agent card
    Then the agent list opens in place of the picker

  @integration
  Scenario: Choosing an evaluator goes to the evaluator list
    When I open the picker
    And I choose the evaluator card
    Then the evaluator list opens in place of the picker

  @integration
  Scenario: Choosing a comparison lists the comparisons I already have
    When I open the picker
    And I choose the comparison card
    Then the evaluator list opens, narrowed to comparisons
    And the picker stays behind it, so the back arrow returns to it
    # Not "in place of". A comparison is created from that list, and the
    # creation form's back arrow has to land somewhere: replacing the picker
    # would dead-end it.

  @integration
  Scenario: A caller that handles the choice itself is told what was picked
    Given the run handed the picker its own handler for the choice
    When I open the picker
    And I choose the prompt card
    Then the run's handler is told a prompt was chosen

  @integration
  Scenario: Cancelling adds nothing
    When I open the picker
    And I cancel
    Then the picker closes and the evaluation is unchanged
