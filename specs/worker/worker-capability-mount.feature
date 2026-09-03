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

  Rule: The tenancy graph is this process's own, or it is nothing

    Organizations, projects and permission reads are one graph over one Prisma
    client. A process that composed half of it would answer some tenancy
    questions and silently refuse others, which reads from the outside like a
    permission decision rather than a missing capability.

    @unit
    Scenario: The worker composes the tenancy graph from its own client
      Given the one Prisma client this process opened
      When the worker composes its tenancy
      Then it holds the organization, project, authorization and grant capabilities together

    @unit
    Scenario: An organization's stored settings are read with this process's cipher
      Given an organization whose stored settings hold encrypted values
      When the worker reads those settings through its composed tenancy
      Then they come back decrypted with the cipher this process was given

    @unit
    Scenario: The worker names the half of the tenancy graph it does not serve
      Given the worker serves no grant write path
      When it composes its tenancy
      Then that absence is reported once, at composition, rather than at the first call

    @unit
    Scenario: A worker with no database composes no tenancy graph
      Given a process that opened no client
      When it tries to compose its tenancy
      Then nothing is composed

  Rule: One model gateway, over that graph, or none

    Two gateways would be two decryptions of the same stored credential and two
    answers to which model a project uses. A gateway composed without the
    deployment's cipher is worse than none: every provider reads as configured
    and fails at the call with the customer's own key blamed.

    @unit
    Scenario: A worker holding the tenancy graph composes the model gateway
      Given a composed tenancy graph and the deployment's cipher
      When the worker composes its model providers
      Then the gateway is composed and no absence is reported for it

    @unit
    Scenario: A worker with no tenancy graph composes no model gateway
      Given a process that composed no tenancy graph
      When it tries to compose its model providers
      Then nothing is composed
      And the absence names the missing tenancy graph rather than a generic failure

    @unit
    Scenario: A worker with no credentials key composes no model gateway
      Given a deployment that named no stored-secret key
      When the worker tries to compose its model providers
      Then nothing is composed
      And the absence names the missing cipher, apart from the missing tenancy graph

    @unit
    Scenario: The gateway decrypts a stored credential with the deployment's own cipher
      Given a project with a saved provider credential
      When the composed gateway resolves that project's execution providers
      Then the customer's key is handed on decrypted, never as the stored ciphertext

    @unit
    Scenario: A worker with no Redis names the uncountable connection window
      Given a deployment that configured no Redis
      When the worker composes its model providers
      Then it reports that the shared connection-test window cannot be counted here
      And it reports the absent translation beside it

    @unit
    Scenario: A worker holding Redis counts its connection windows
      Given a deployment that configured Redis
      When the worker composes its model providers
      Then it says nothing about uncountable connection windows

    @unit
    Scenario: Topic clustering and evaluation resolve through one gateway
      Given a worker that composed a model gateway
      When both topic clustering and the evaluator environment resolve a model
      Then both reach the same gateway instance

    @unit
    Scenario: Topic clustering resolves its models through the composed gateway
      Given a worker that composed a model gateway
      When a clustering page resolves its clustering, embedding and execution models
      Then every one of them is answered by that gateway under the clustering feature keys
