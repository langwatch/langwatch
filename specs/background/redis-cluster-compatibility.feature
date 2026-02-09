Feature: BullMQ Redis Cluster Compatibility
  As a LangWatch operator deploying with Redis Cluster
  I want all BullMQ queues to use Redis hash tags
  So that queue operations do not fail with CROSSSLOT errors

  # Redis Cluster distributes keys across slots by hashing the key name.
  # BullMQ uses multiple keys per queue (e.g., bull:<name>:wait, bull:<name>:active).
  # Without hash tags, those keys may land on different slots, causing CROSSSLOT
  # errors from Lua scripts that touch multiple keys atomically.
  #
  # Wrapping queue names in {braces} forces Redis to hash only the braced
  # portion, guaranteeing all keys for a queue land on the same slot.

  @integration
  Scenario: Adding a job to a queue without a hash tag fails on Redis Cluster
    Given a Redis Cluster is running
    And a BullMQ queue named "no-hash-tag"
    When a job is added to the queue
    Then the operation fails with a CROSSSLOT error

  @integration
  Scenario: Adding and processing a job succeeds when the queue name has a hash tag
    Given a Redis Cluster is running
    And a BullMQ queue named "{with_hash_tag}"
    And a worker is listening on the same queue
    When a job is added to the queue
    Then the job is processed successfully without errors

  @integration
  Scenario: Background worker queues operate on Redis Cluster
    Given a Redis Cluster is running
    And the background worker queue names are loaded from configuration
    Then every background worker queue name contains a hash tag
    And adding a job to each queue succeeds on the cluster

  @integration
  Scenario: Event sourcing maintenance worker queue operates on Redis Cluster
    Given a Redis Cluster is running
    And the event sourcing maintenance worker queue name is loaded
    Then the queue name contains a hash tag
    And adding a job to the queue succeeds on the cluster

  @integration
  Scenario: Event sourcing pipeline queues operate on Redis Cluster
    Given a Redis Cluster is running
    And event sourcing pipeline queues are created for handlers, projections, and commands
    Then every pipeline queue name contains a hash tag
    And adding a job to each pipeline queue succeeds on the cluster

  @unit
  Scenario: Every queue name produced by the system contains a hash tag
    Given all queue name sources in the codebase
    When each source produces its queue name
    Then every produced name matches the pattern "{...}"
