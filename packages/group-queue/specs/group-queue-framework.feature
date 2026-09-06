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

  Rule: A dedup id squashes concurrent stages to exactly one job

    @integration
    Scenario: A dedup TOCTOU race between concurrent stages squashes to exactly one job
      Given ten concurrent stage calls sharing one dedup id
      When they all resolve
      Then exactly one job remains in the group
      And the dedup key names that survivor
      And exactly one of the ten calls reports itself as new

    @integration
    Scenario: A stage racing a dispatch of its own dedup key never double-counts pending
      Given a dedup'd job staged and due for dispatch
      When a dispatch of that job and a new stage on the same dedup id settle concurrently
      Then the total-pending counter still equals the group's actual staged jobs

  Rule: A dedup squash transfers its blob lease atomically, never leaving a phantom or an early reclaim

    @integration
    Scenario: Concurrent squashes on one dedup id never leave more than the winner's lease live
      Given several concurrent stages racing to squash the same dedup id, each holding its own blob lease
      When every squash settles
      Then exactly one contender's lease is live
      And no lease is taken for any losing contender

    @integration
    Scenario: A squash racing a sibling's release never double-releases or resurrects a lease
      Given a squash displacing a lease while a sibling holder concurrently releases its own lease on the same blob
      When the squash and the release settle
      Then the lease set holds only tokens that were staged or released, never a phantom
      And the replacement value's lease is live

  Rule: A displaced blob ref never crosses tenant boundaries

    @integration
    Scenario: A squash never reclaims or touches a displaced blob ref belonging to another tenant
      Given a dedup squash that displaces a value whose blob ref names another tenant
      When the squash resolves
      Then the foreign tenant's lease and blob are left untouched

  Rule: A stale heartbeat after a retry cannot resurrect the pre-retry lock or schedule

    @integration
    Scenario: A stale heartbeat after a retry never extends the retry's backoff lock or ready score
      Given a job dispatched and then retried under a new staged id
      When a heartbeat for the retired staged id lands after the retry
      Then the heartbeat is refused
      And the retry's backoff TTL is not extended
      And the ready score still reflects the retry's schedule, not a fresh active window
