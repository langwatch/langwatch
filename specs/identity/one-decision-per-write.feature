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
  # The queue is OFF sign-up's critical path. Sign-up returns once the rows it
  # writes itself are committed and the command is handed to the queue; it
  # never waits for the fold. The surfaces that READ projections are the ones
  # that carry the wait, and they are the ones that have to say so.

  # becomes @integration
  @unimplemented
  Scenario: A sign-up does not wait for its fold
    Given I am signing up
    When my account is committed and the write is handed to the queue
    Then I am signed in without waiting for the fold to land
    And nothing I am shown claims the write has been recorded

  # THE REGRESSION THIS MUST NOT CAUSE. An empty projection means two different
  # things, and a surface that cannot tell them apart tells a brand-new person
  # on a verified company domain that there is nothing for them to join — then
  # sends them off to start their own organization, which is the exact outcome
  # join-before-create exists to prevent.
  # becomes @integration @e2e
  @unimplemented
  Scenario: A surface reading an unfolded account says "not yet", never "nothing"
    Given I have just signed up
    And the fold has not landed
    When I open a screen that reads my identifiers
    Then it tells me my account is still being set up
    And it does not tell me I hold no address
    And it does not offer to start an organization as though no team matched me
    And it keeps checking without me doing anything
    And I am never shown an address or a method as though it were already mine

  # becomes @unit
  @unimplemented
  Scenario: An empty projection with a landed fold is a real empty state
    Given a person whose fold has landed
    And they hold no identifiers
    When a screen reads their identifiers
    Then it shows the real empty state rather than saying it is still setting up

  # becomes @integration
  @unimplemented
  Scenario: A write that never lands leaves nothing claiming it did
    Given I have signed up
    And the write is never applied
    Then my account exists and nothing in it claims the write succeeded
    And the screen that was waiting stops saying it is still being set up
    And it tells me that part could not be finished

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
