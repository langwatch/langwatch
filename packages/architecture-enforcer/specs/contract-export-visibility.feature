Feature: A contract export meant for its owner, or a tuning number, is not imported by a peer module
  As a maintainer
  I want a module's URL parameter names and tuning numbers to stay inside the module
  So that the owner can change an address or a timeout without a peer silently keeping the old one

  See dev/docs/plans/platform-architecture-blocks.md rules 12b and 12c (Alex, 2026-10-20).
  A contract export tagged `@ownerOnly` may be imported only by packages of the same module.
  A contract export named like a tuning number (`*_MS`, `*_SECONDS`, `*_MINUTES`, `*_HOURS`,
  `*_TTL`, `*_DELAY`, `*_RETRIES`, `*_ATTEMPTS`, `*_TIMEOUT`, `*_INTERVAL` or holding `_BEFORE_`)
  is the owner's to interpret: a peer asks the
  owner what the number decides. A use counts whether it is a named import, a named re-export,
  or a member read off a namespace import (`contract.A_PARAM`). Both are fix rules: main runs at zero and the policies block in CI.

  @unit @architecture
  Scenario: A peer module importing an @ownerOnly export is reported
    Given module a's contract exports a constant tagged @ownerOnly
    And module b imports it by name, and an app re-exports it
    When the owner-only-constant policy reads the tree
    Then it reports both uses

  @unit @architecture
  Scenario: A peer module reading an @ownerOnly export off a namespace import is reported
    Given module a's contract exports a constant tagged @ownerOnly
    And module b imports module a's contract as a namespace and reads the constant off it
    When the owner-only-constant policy reads the tree
    Then it reports the read, and not an untagged member read the same way

  @unit @architecture
  Scenario: The owner's own packages and untagged exports are not reported
    Given module a's contract exports an @ownerOnly constant and an untagged constant
    And module a's process and browser import the tagged one, and module b imports the untagged one
    When the owner-only-constant policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: An owner-only finding says what to do instead
    Given module b imports module a's @ownerOnly constant
    When the owner-only-constant policy reports it
    Then the message names the constant, its owner and the importer
    And it tells the author to ask the owner for an action or a link builder

  @unit @architecture
  Scenario: A peer module importing a tuning number is reported
    Given module a's contract exports numbers named like a timeout, a TTL in seconds, a retry count, an attempt count, an interval and a days-before count
    And module b imports each of them
    When the contract-tuning-constant policy reads the tree
    Then it reports each import

  @unit @architecture
  Scenario: Minutes, hours, TTLs, delays and namespace reads are tuning numbers too
    Given module a's contract exports numbers named like minutes, hours, a TTL and a delay
    And module b reads each of them off a namespace import of module a's contract
    When the contract-tuning-constant policy reads the tree
    Then it reports each read

  @unit @architecture
  Scenario: The owner's own packages, strings, maps and type imports are not reported
    Given module a's contract exports a timeout, a string named like a tuning number and a map named like one
    And module a's process imports the timeout
    And module b imports the string and the map, and a type-only import of the timeout
    When the contract-tuning-constant policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: A tuning number finding says what to do instead
    Given module b imports module a's timeout constant
    When the contract-tuning-constant policy reports it
    Then the message names the constant, its owner and the importer
    And it tells the author to ask the owner through its Api for what the number decides
