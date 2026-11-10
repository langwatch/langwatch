Feature: Traces withheld while an organization is over its plan

  An organization that falls to the Free plan, because it cancelled or because
  an unpaid renewal reached day 21 of payment recovery, while it holds more
  members than the Free plan allows, is over its plan. Its traces keep being
  ingested and stored. Traces from before the downgrade stay fully visible.
  Traces recorded after the downgrade are withheld by the server: lists and
  searches answer only how many there are, and opening one answers a handled
  error. The state ends as soon as the organization is on a paid plan again or
  its members fit the Free plan, and every withheld trace shows again.

  Only a downgrade that happens after this ships starts the state. An
  organization that already holds more members than its plan, on purpose or
  from before, is never affected. Nobody is forced to remove members.

  Background:
    Given the Free plan covers 2 members

  # Starting the state (billing owns it)

  @unit
  Scenario: Cancelling with more members than Free allows starts the over-plan state
    Given an organization on Growth with 5 members
    When its subscription is cancelled
    Then the organization is over its plan from the cancellation time
    And billing records an over-plan started fact with the cutoff time, 5 members and 2 covered

  @unit
  Scenario: Cancelling within the Free member limit starts nothing
    Given an organization on Growth with 2 members
    When its subscription is cancelled
    Then the organization is not over its plan
    And no over-plan fact is recorded

  @unit
  Scenario: An unpaid renewal reaching day 21 with too many members starts the state at day 21
    Given an organization on Growth with 4 members and a renewal that failed 21 days ago
    When the payment recovery sweep sends the day 21 notice
    Then the organization is over its plan from day 21 of the case

  @unit
  Scenario: An organization over its member count without a recorded downgrade is never affected
    Given an organization on the Free plan with 6 members
    And no downgrade was recorded for it
    When its plan is read
    Then the plan carries no over-plan state

  @integration
  Scenario: The over-plan mark is stored on the subscription and read back while open
    Given a cancelled subscription marked over plan from a cutoff time
    When billing reads the organization's open over-plan marks
    Then it finds the mark with that cutoff time
    And once the mark is ended it finds none

  # Ending the state

  @unit
  Scenario: The state ends at once when the organization is back on a paid plan
    Given an organization over its plan
    When it subscribes to Growth again
    Then its plan carries no over-plan state

  @unit
  Scenario: The state ends at once when the members fit the Free plan
    Given an organization over its plan with 3 members
    When an administrator removes 1 member
    Then its plan carries no over-plan state

  @unit
  Scenario: The sweep records the end of a state whose condition no longer holds
    Given an organization over its plan whose members now fit the Free plan
    When the over-plan sweep runs
    Then the mark is ended
    And billing records an over-plan ended fact

  @unit
  Scenario: A state still in force stays open on the sweep
    Given an organization over its plan with 5 members on the Free plan
    When the over-plan sweep runs
    Then the mark stays open and no fact is recorded

  # Reading traces (trace asks billing through the plan)

  @unit
  Scenario: A trace list answers only the count of traces recorded after the cutoff
    Given an organization over its plan from a cutoff time
    And 3 traces before the cutoff and 4 traces after it
    When a member lists the project's traces
    Then the list holds the 3 traces from before the cutoff with their content
    And it says 4 traces are withheld, with 5 members and 2 covered

  @unit
  Scenario: Opening a trace recorded after the cutoff answers a handled error
    Given an organization over its plan from a cutoff time
    When a member opens a trace recorded after the cutoff
    Then the read fails with the code "trace_withheld_over_plan"

  @unit
  Scenario: A trace recorded before the cutoff opens in full
    Given an organization over its plan from a cutoff time
    When a member opens a trace recorded before the cutoff
    Then the trace is returned with its content

  @unit
  Scenario: A plan without an over-plan state withholds nothing
    Given an organization on the Free plan with no over-plan state
    When a member lists the project's traces
    Then no trace is withheld and the list says nothing is withheld

  # The traces page

  @integration
  Scenario: The traces page shows one line with the numbers and both actions
    Given an organization over its plan with 5 members and 4 withheld traces
    When a member opens the traces page
    Then it shows "Your plan covers 2 members and you have 5. New traces are saved and will show once you update your card or remove 3 members."
    And it offers "Update card" linking to the subscription page
    And it offers "Manage members" linking to the members page

  @integration
  Scenario: The traces page shows no line when nothing is withheld
    Given an organization on the Free plan with no over-plan state
    When a member opens the traces page
    Then the over-plan line is not shown
