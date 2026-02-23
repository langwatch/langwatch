Feature: Process Roles

  The event sourcing runtime supports different roles to optimize resource usage
  and prevent event loop contention.

  Scenario: Web process role
    Given an EventSourcing instance initialized with processRole: "web"
    When a pipeline is registered
    Then command queue dispatchers are initialized for sending
    And BullMQ workers for projections are NOT started
    And BullMQ workers for reactors are NOT started
    And background processing is offloaded to other processes

  Scenario: Worker process role
    Given an EventSourcing instance initialized with processRole: "worker"
    When a pipeline is registered
    Then command queue dispatchers are initialized for processing
    And BullMQ workers for fold projections are started
    And BullMQ workers for map projections are started
    And BullMQ workers for reactors are started
