Feature: Langy renders domain-capability cards for tool calls
  As a LangWatch user chatting with Langy
  I want each of Langy's tool calls to render as a purpose-built card for that capability
  So that I can read results in place, apply proposed changes deliberately, and jump to the right surface

  # Cards are keyed off the tool-call NAME in the assistant turn's tool parts.
  # Governing rule: propose-then-apply. Reads render results inline with no
  # Apply; writes are staged proposals (Apply / Discard); destructive actions
  # are confirm-gated in red; every card offers an "Open in <surface>" deep link.
  # Any tool with no mapping falls through to the existing raw-JSON fallback.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  @integration
  Scenario: A trace search renders results inline with no Apply
    When Langy runs the trace-search capability and it returns matching traces
    Then Langy shows a traces card listing the matched traces
    And each trace row links to that trace
    And the card offers an "Open in Traces" link
    And the card shows no Apply or Discard action

  @integration
  Scenario: A single trace lookup renders a span summary
    When Langy runs the single-trace capability for one trace
    Then Langy shows a trace card summarising that one trace
    And the card links to that trace

  @integration
  Scenario: An analytics query renders as a metrics card
    When Langy runs the analytics capability and it returns numbers
    Then Langy shows a metrics card with the reported figures
    And each figure rolls up from zero as a rolling number
    And the card offers an "Open in Analytics" link

  @integration
  Scenario: An evaluation run renders its result
    When Langy runs an experiment or suite and it completes
    Then Langy shows an evaluation-run card with the run outcome
    And the card links to the run

  @integration
  Scenario: Creating a resource renders as a proposal until I apply it
    Given Langy has staged a new evaluator as a proposal
    Then the card reads as a proposal with Apply and Discard actions
    And nothing is created until I choose Apply
    When I choose Apply
    Then the card flips to an applied state with an "Open evaluator" link

  @integration
  Scenario: A destructive action is gated behind a red confirm
    Given Langy has staged the deletion of an evaluator
    Then the card reads as destructive in red
    And the confirming action is labelled to make the deletion explicit
    And a Cancel action is offered alongside it

  @integration
  Scenario: A prompt update renders as a before-and-after diff
    When Langy proposes an update to a prompt
    Then the card shows the prompt change as a before-and-after comparison
    And I can apply or discard the change

  @integration
  Scenario: A dataset listing renders the records inline
    When Langy lists a dataset and it returns records
    Then Langy shows a dataset card summarising the records
    And the card offers an "Open in Datasets" link

  @integration
  Scenario: A scenario result renders as a scenario card
    When Langy runs or fetches a scenario simulation
    Then Langy shows a scenario card with the scenario outcome
    And the card links to Simulations

  @integration
  Scenario: An unmapped tool falls through to the raw view
    When Langy runs a tool that has no capability card
    Then Langy shows the tool's raw name, state, input, and output
    And it does not fabricate a card it has no mapping for

  @integration
  Scenario: A capability tool still in flight reads as an activity line
    Given Langy has started a trace search that has not returned yet
    Then Langy shows a pending activity line for the search
    And the traces card only appears once the search returns

  @integration
  Scenario: Developer mode exposes the raw payload behind every card
    Given developer mode is on
    When Langy renders any capability card
    Then I can reveal the raw tool payload behind the card
