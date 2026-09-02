@unit
Feature: The worker composes every capability for itself

  The background worker used to receive five capabilities pre-built from the
  application: the Eventing substrate's two sweeps, Evaluation's processing
  definition, Topic's whole runtime, Enterprise Governance's ingestion runtime
  and the SSO connection definition. Each arrived as an object the worker could
  not inspect, so a graph that merely passed one through was indistinguishable
  from a graph that composed one.

  Background:
    Given a worker composed from its own configuration and substrates
    And no capability is handed to it by an application

  @unit
  Scenario: A worker routes every key the frozen registry names
    When every feature installs
    Then the routed job keys are exactly the keys the frozen job registry names
    And a capability that stopped composing removes its own keys from that set

  @unit
  Scenario: The blob sweep walks the queue's own keyspace
    When the substrate maintenance sweep runs
    Then it reads the queue registry through the same Redis connection the
      Group Queue offloads payloads onto
    And a sweep on a second connection reports an empty keyspace forever

  @unit
  Scenario: Online evaluation refuses by name rather than reporting a result
    Given the process cannot resolve a customer's model provider
    When an evaluation the platform would run itself is dispatched
    Then the command is still routed
    And the run refuses by name instead of reporting a skipped evaluation

  @unit
  Scenario: Topic clustering refuses by name rather than inventing a model
    Given the process cannot resolve a project's clustering model
    When a clustering page runs
    Then every model resolution refuses by name
    And no topic is named with a provider the customer did not choose

  @unit
  Scenario: The clustering page posts its body directly
    Given the deployment named an evaluator service endpoint
    When a clustering page is sent
    Then the page body is posted to that endpoint as JSON
