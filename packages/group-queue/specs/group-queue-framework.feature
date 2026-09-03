# See ../adrs/20260820-group-queue-framework-boundary.md
Feature: Group Queue framework boundary

  As an application framework author
  I want ordered background work to be defined once and exposed through
  separate producer and consumer capabilities
  So that queue mechanics remain reusable and invalid integrations are hard
  to construct

  @unit @architecture
  Scenario: A queue definition fixes its transport contract
    Given a payload schema, a group-key rule and an identity rule
    When a Group Queue definition is built
    Then its name and rules are immutable
    And both producer and consumer use that same definition

  @typecheck @architecture
  Scenario: Producer and consumer capabilities cannot be confused
    Given a Group Queue producer
    And a GroupQueueConsumer for the same definition
    Then it cannot register a handler or claim a group
    And the consumer cannot bypass the definition's payload decoder or identity rule

  @integration
  Scenario: A GroupQueueConsumer preserves order within a group
    Given two valid jobs for the same group in staging order
    And a GroupQueueConsumer for their definition
    When the consumer handles the group
    Then the first job completes before the second handler starts

  @integration
  Scenario: Independent groups may make progress concurrently
    Given valid jobs for two different groups
    When a GroupQueueConsumer handles available work
    Then work in one group does not wait for the other group to finish

  @unit @regression
  Scenario: The canonical envelope round-trips a payload
    Given a job encoded as a version 2 Group Queue envelope
    When the package decodes the stored value
    Then the handler payload is deep-equal to the staged payload
    And its routing descriptor is available without decoding an offloaded body

  @integration @durability
  Scenario: An unreadable job does not wedge its group
    Given an invalid staged value followed by a valid job in the same group
    When a GroupQueueConsumer encounters the invalid value
    Then the failure is attributed without exposing its payload
    And recoverable body data is not destroyed
    And the following valid job remains dispatchable

  @unit @architecture
  Scenario: Application policy is supplied before queue construction
    Given an application chooses a queue policy from configuration or flags
    When it constructs a Group Queue capability
    Then the capability receives plain validated policy values
    And the Group Queue package never calls an application feature flag service

  @unit @shutdown
  Scenario: Closing a GroupQueueConsumer drains claimed work within its budget
    Given a GroupQueueConsumer with claimed work
    When the application asks it to close with a drain budget
    Then it stops claiming new groups
    And it finishes or safely re-stages the claimed work within that budget

  @typecheck @architecture
  Scenario: Group Queue has no Eventing or application dependency
    Given the Group Queue package dependency graph
    Then it contains no import from Eventing, the platform app or enterprise code
    And only declared public subpaths can be imported by consumers
