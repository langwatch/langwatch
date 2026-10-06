Feature: Langy service capability

  @unit
  Scenario: transports share one Langy capability
    Given a process has constructed one LangyService
    When a public or internal adapter handles a Langy request
    Then it delegates to that same service instance

  @unit
  Scenario: Langy owns its subordinate subjects
    Given the Langy feature owns conversations, turns, messages, credentials, and relay frames
    When an application transport needs one of those capabilities
    Then it reaches it through the process-composed LangyService

  @unit
  Scenario: composition hides persistence
    Given a process-owned database and Langy capability ports
    When the composition root builds Langy through PostgresLangyAdapter
    Then it receives the contract LangyService
    And no repository or generated database type is part of the public service surface

  @unit
  Scenario: application transports use the flat contract
    Given the application has one contract LangyService instance
    When a transport lists conversations, starts a turn, or ingests a relay result
    Then it calls the corresponding LangyService method directly
    And it does not reach through a subordinate capability property

  @unit
  Scenario: a finalized turn's block salvage is counted on the published series
    Given a process composed Langy with a block-metrics collector
    When a finalized turn's derived card fails to salvage
    Then the failure is counted on the block-salvage series under its reason

  @unit
  Scenario: feedback prompt keeps its existing cadence
    Given a process-owned LangyService with Redis available
    When feedback is checked after an assistant answer
    Then it never asks before two assistant answers
    And a shown card starts a three-day per-user quiet period
    And a long conversation may ask once in another conversation
    And the cadence record expires after thirty days

  @unit
  Scenario: feedback prompt is safe when Redis is unavailable
    Given a process-owned LangyService without readable Redis
    When feedback is checked or marked shown
    Then the read returns false
    And the write does not throw

  @integration
  Scenario: The worker folds a created langy conversation into its projection
    Given the worker boots with live eventing and langy's rows in a test database
    When langy's conversation pipeline is sent a created conversation
    Then the conversation is readable through its projection

  @unit
  Scenario: A new conversation takes its placeholder title in sentence case
    Given a new conversation whose first user message reads "apidiff question"
    When its first turn is accepted
    Then the recorded message carries the title "Apidiff question"
    And the conversation starts with no chosen title, so a generated title can replace it
