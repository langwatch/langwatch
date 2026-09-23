Feature: The module-layers lint rule
  The layer grammar of a module's process package, read from the tables in
  packages/oxlint-rules/grammar/module-layers.mjs (ARCHITECTURE.md §3.2, §8).
  A repository takes the store it reads, a channel the client it speaks to, a
  transport never names a repository, a service or a channel, and a service
  works over repository and channel interfaces rather than the implementation
  below one. Each importing layer has its own message, so the fix printed is
  the one that layer can apply.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A repository takes the store it reads and nothing above it
    Given a repository value-importing a service, the app or a pipeline projection
    When the module-layers rule runs over it
    Then it reports repositoryCrossing on each import's line
    And its siblings, a rules module, an eventing store and type-only imports pass

  @unit
  Scenario: A channel takes the client it speaks to
    Given a channel value-importing a repository, a service and its own client
    When the module-layers rule runs over it
    Then it reports channelCrossing for the repository and the service only

  @unit
  Scenario: A transport never names a repository, even as a type
    Given a transport importing a repository by relative path as a type and by alias as a value
    When the module-layers rule runs over it
    Then it reports transportCrossing for both

  @unit
  Scenario: A transport never names a service or a channel, even as a type
    Given a transport importing its contract, its app type, a service, a channel interface and a channel tier type
    When the module-layers rule runs over it
    Then it reports transportCrossing for the service and both channels on their lines
    And the message asks it to call the operation on the app the handler receives

  @unit
  Scenario: A service works over repository interfaces, never a backend
    Given a service importing a repository interface, a Prisma backend and a ClickHouse backend type
    When the module-layers rule runs over it
    Then it reports serviceNamesABackend for both backends and passes the interface

  @unit
  Scenario: A service works over channel interfaces, never a tier implementation
    Given a service importing a channel interface, a Slack channel and a memory twin type
    When the module-layers rule runs over it
    Then it reports serviceNamesAChannelImplementation for the Slack channel and the memory twin
    And it passes the interface

  @unit
  Scenario: A test composing a layer is not this rule's business
    Given a repository unit test that imports a service
    When the module-layers rule runs over it
    Then it reports nothing
