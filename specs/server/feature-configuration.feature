Feature: Feature configuration is one schema, validated at boot
  A feature that reads runtime configuration declares one Zod schema for the
  half that reads it, in its contract, beside the rules that use it. The
  process roots parse the whole graph once, before anything else happens: no
  migration runs, no queue connects, no listener binds and no browser renders
  over a configuration that has not been validated.

  Background:
    Given a LangWatch process starts from an environment

  @unit
  Scenario: A feature reads its configuration through its own schema
    Given a feature that consumes runtime configuration
    When the process resolves its configuration
    Then the feature's own schema declares every leaf it reads
    And the environment variable each leaf reads keeps the name a deployment already uses

  @unit
  Scenario: A cross-field rule refuses a half-configured feature at boot
    Given a feature whose leaves are only meaningful together
    When a deployment sets some of them and not the rest
    Then the process refuses to start and names what is missing
    And no request reaches the half-configured surface

  @unit
  Scenario: An unreadable switch is refused instead of read as off
    Given a switch a deployment wrote in a spelling nothing reads
    When the process resolves its configuration
    Then the process refuses to start
    And the operator is told rather than left with a surface quietly off

  @unit
  Scenario: A blank identifier resolves to absent rather than to an empty filter
    Given an identifier a deployment exported blank
    When the process resolves its configuration
    Then the identifier reads as absent
    And no query is widened by an empty value

  @unit
  Scenario: An absent allowlist resolves to an empty one, never a wildcard
    Given a deployment that names no allowed hosts
    When the process resolves its configuration
    Then the allowlist is empty
    And the fence still fences

  @unit
  Scenario: A feature's defaults are the values a deployment already runs on
    Given a deployment that overrides nothing
    When the process resolves its configuration
    Then every default equals the value that deployment ran on before

  @unit
  Scenario: One variable has one owner across every process
    Given a variable two processes both read
    When each process resolves its configuration
    Then both read it through the same feature schema
    And neither can reach a different answer from the same value

  @unit
  Scenario: A named but unusable configuration refuses the boot
    Given a deployment that named a configuration document it did not complete
    When the process resolves its configuration
    Then the process refuses to start
    And it does not quietly fall back to a different destination

  @unit
  Scenario: The API validates its configuration before it composes or listens
    Given an environment carrying an unreadable value
    When the API process boots
    Then it refuses before composing a graph
    And it refuses before binding a listener

  @unit
  Scenario: The worker validates its configuration before it connects or consumes
    Given an environment carrying an unreadable value
    When the worker process boots
    Then it refuses before observability, resources or composition exist
    And no queue is connected and no job is claimed

  @unit
  Scenario: The task process validates its configuration before a migration runs
    Given an environment carrying an unreadable value
    When the task process boots
    Then it refuses before the catalogue is built
    And no migration and no backfill runs

  @unit
  Scenario: The browser validates its configuration before the first render
    Given a public application configuration served in the HTML shell
    When the browser application boots
    Then every feature's own web schema has parsed its slice
    And nothing is rendered over a configuration that did not parse
