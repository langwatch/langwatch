@unit
Feature: The worker is the installed module list in the worker role

  The background worker holds no capability of its own. It boots every
  installed module in the worker role, and each capability another module reads
  (the substrate's sweeps, tenancy, the model gateway) arrives as that module's
  API from the one graph, so a process that wires one differently would answer
  differently from the interactive process.

  Background:
    Given the worker booted over the installed module list
    And no capability is handed to it by an application

  @unit
  Scenario: A worker routes every key the installed pipelines declare
    When every feature installs
    Then the routed command and projection keys are exactly the keys the installed pipelines declare
    And a pipeline that stopped installing removes its own keys from that set

  @unit
  Scenario: The worker hosts the queue's blob sweep and the process retention sweep
    When every feature installs
    Then the blob maintenance pipeline and the process manager maintenance pipeline are hosted
    And each one's process manager runs on a schedule

  @unit
  Scenario: Online evaluation reports a skipped run when its provider is not configured
    Given an evaluation names a model provider the project has not configured
    When the evaluation the platform would run itself is dispatched
    Then the run is reported as skipped, not as an error
    And the reason is carried so the customer can act on it

  @unit
  Scenario: Topic clustering names the provider it cannot use rather than inventing a model
    Given the project's embeddings model names a provider that is missing or disabled
    When a clustering page resolves its embeddings model
    Then the resolution refuses naming that provider
    And no topic is named with a provider the customer did not choose

  @unit
  Scenario: The clustering page posts its body directly
    Given the deployment named an evaluator service endpoint
    When a clustering page is sent
    Then the page body is posted to that endpoint as JSON

  Rule: The tenancy graph is the booted module graph, or it is nothing

    Organizations, projects and permission reads are each a module's API. A
    process that held only some of them would answer some tenancy questions and
    silently refuse others, which reads from the outside like a permission
    decision rather than a missing capability.

    @unit
    Scenario: The worker serves the organization, project and authorization capabilities together
      Given the worker booted over the installed module list
      When the worker reads its tenancy
      Then the organization, project and authorization capabilities are all served

    @unit
    Scenario: An organization's stored settings are read with this process's cipher
      Given an organization whose stored settings hold encrypted values
      When the settings are read through the organization repository
      Then they come back decrypted with the cipher this process was given

    # Alex 2026-10-06: never built. No half of the tenancy graph is left out of
    # the worker, so no absence is reported for it at composition.
    @unit @unimplemented
    Scenario: The worker names the half of the tenancy graph it does not serve
      Given the worker serves no grant write path
      When it composes its tenancy
      Then that absence is reported once, at composition, rather than at the first call

    @unit
    Scenario: The tenancy graph is the one the module graph booted
      Given the one graph this process boots over the installed module list
      When the worker reads its tenancy twice
      Then each capability is the same instance both times
      And an installed module declares it as a dependency

  Rule: One model gateway, over that graph

    Two gateways would be two decryptions of the same stored credential and two
    answers to which model a project uses. A cipher without a key refuses at
    its use rather than reading every provider as configured and failing at the
    call with the customer's own key blamed.

    @unit
    Scenario: The worker installs the model gateway beside the tenancy graph
      Given the booted module graph
      When the worker reads its model providers
      Then the model provider capability is served

    @unit
    Scenario: A deployment with no stored-secret key refuses each use of the cipher by name
      Given a deployment that named no stored-secret key
      When the worker opens its stores
      Then the boot is not refused
      And each encrypt and decrypt refuses as the unconfigured encryption member

    @unit
    Scenario: The gateway decrypts a stored credential with the deployment's own cipher
      Given a project with a saved provider credential
      When the credential is read
      Then the customer's key is handed on decrypted, never as the stored ciphertext

    @unit
    Scenario: A worker with no Redis counts its connection windows in process memory
      Given a deployment that configured no Redis
      When connection tests are counted
      Then the windows are counted in this process's own memory
      And a test past the ceiling is refused with the seconds until the window reopens

    @unit
    Scenario: A worker holding Redis counts its connection windows
      Given a deployment that configured Redis
      When connection tests are counted
      Then the windows are counted in Redis, shared by every replica

    @unit
    Scenario: Topic clustering and evaluation resolve through one gateway
      Given the booted module graph
      When both topic clustering and evaluation need a model provider
      Then both declare the model provider capability as their dependency
      And the graph serves one instance of it

    @unit
    Scenario: Topic clustering resolves its models through the composed gateway
      Given a worker that composed a model gateway
      When a clustering page resolves its clustering, embedding and execution models
      Then every one of them is answered by that gateway under the clustering feature keys
