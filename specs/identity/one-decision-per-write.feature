# See dev/docs/adr/135-a-write-states-its-facts-once.md for the architectural
# rationale this file is the behavioural contract for.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds.
# The change these describe has not landed; tagging them @unit or @integration
# now would report a binding that does not exist. Each scenario names the tag
# it becomes in a comment above it, and the implementation commit that makes it
# pass swaps the tag and adds the `@scenario "<title>"` annotation in the same
# change. A scenario still carrying @unimplemented when the work is called done
# is work that was not done.

Feature: A write states its facts once
  As somebody whose account is changed by something I did
  I want what I am told to match what was actually recorded
  So that the system never reports a decision it did not keep

  # The pipeline decides on the queue, where ordering exists. The calling path
  # dispatches and waits; it never decides, never appends, and never writes a
  # projection row of its own. What a caller learns, it learns by reading what
  # landed.

  Background:
    Given the identity write path is dispatch-and-read

  # --- One decision ------------------------------------------------------
  #
  # The defect ADR-135 removes: the guard used to run on the calling path AND
  # again on the queue, on state that may have moved between them.

  # becomes @unit
  @unimplemented
  Scenario: A command is decided once, where it is ordered
    When a write verb is called
    Then the rule that decides what it states runs exactly once
    And it runs on the queue rather than on the caller's thread

  # becomes @unit
  @unimplemented
  Scenario: A caller is handed a receipt rather than a decision
    When a write verb is called
    Then it answers with the identity of the command and whether it landed
    And it never answers with facts that nothing has recorded

  # becomes @integration
  @unimplemented
  Scenario: Nothing writes a projection row that no event caused
    Given a write whose fold has not run yet
    When I read the projection
    Then I see no row for that write
    And no row anywhere asserts a fact the log does not hold

  # --- Reading the outcome instead of the intention -----------------------

  # becomes @integration
  @unimplemented
  Scenario: A caller that needs the outcome reads what landed
    Given a write that needs its result to continue
    When the fold has applied the write
    Then the caller reads the outcome from the projection
    And what it reads is what was recorded

  # THE ONE THAT REACHED A PERSON. An expiry used to notify on the calling
  # path's decision, so an admin answering a request in the same moment could
  # produce both a membership and an email saying the request lapsed.
  # becomes @integration
  @unimplemented
  Scenario: The expiry notice follows what was recorded, not what was proposed
    Given a join request that an administrator approves while its expiry runs
    When the expiry finishes
    Then the person is told only what actually happened to their request
    And no notice claims a lapse that was not recorded

  # --- Eventual consistency, said out loud --------------------------------
  #
  # The queue is now on sign-up's critical path. That is the trade ADR-135
  # accepts, and this is how it is paid honestly.

  # becomes @integration
  @unimplemented
  Scenario: A sign-up whose fold lands in time continues as before
    Given I am signing up
    When the write is applied within the waiting window
    Then I continue straight into the product
    And nothing tells me anything is pending

  # becomes @integration @e2e
  @unimplemented
  Scenario: A sign-up that outruns the window says it is still finishing
    Given I am signing up
    When the write has not been applied by the end of the waiting window
    Then I am told my account is still being set up
    And the screen keeps checking without me doing anything
    And I am never shown an address or a method as though it were already mine

  # becomes @integration
  @unimplemented
  Scenario: A write that never lands leaves nothing claiming it did
    Given I am signing up
    And the write is never applied
    Then I am told my account could not be finished
    And nothing in my account claims the write succeeded
    And a way to try again is offered

  # --- What must keep working --------------------------------------------

  # becomes @unit
  @unimplemented
  Scenario: A retried write still states its facts only once
    Given a write that is dispatched twice with the same command identity
    When both are applied
    Then the same facts are recorded once
    And the second dispatch changes nothing

  # becomes @integration
  @unimplemented
  Scenario: A write refused by the rule records nothing and says so
    Given a write the rule refuses
    When it is applied
    Then nothing is recorded for it
    And the caller is told it was refused rather than that it is pending
