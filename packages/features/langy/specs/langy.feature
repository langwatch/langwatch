Feature: Langy service capability

  Scenario: transports share one Langy capability
    Given a process has constructed one LangyService
    When a public or internal adapter handles a Langy request
    Then it delegates to that same service instance

  Scenario: relay preserves the event wire contract
    Given a valid Langy relay frame
    When the Langy service relays it
    Then the frame is handed to the relay repository unchanged

  Scenario: Langy owns its subordinate subjects
    Given the Langy feature owns conversations, turns, messages, credentials, and relay frames
    When an application transport needs one of those capabilities
    Then it reaches it through the process-composed LangyService

  Scenario: composition hides persistence
    Given a process-owned database and Langy capability ports
    When the composition root builds Langy through PostgresLangyAdapter
    Then it receives the contract LangyService
    And no repository or generated database type is part of the public service surface

  Scenario: application transports use the flat contract
    Given the application has one contract LangyService instance
    When a transport lists conversations, starts a turn, or ingests a relay result
    Then it calls the corresponding LangyService method directly
    And it does not reach through a subordinate capability property

  Scenario: controlled browser behaviour and presentation are portable
    Given the application renders a Langy conversation surface
    When it derives card order, panel geometry, feedback directives, turn controls, or conversation status
    Then it uses Langy's deterministic browser behaviour and reusable presentation
    And application page composition, state, routes, and transport hooks remain in the application
    And application-specific tool descriptions are supplied through a named narrator port

  Scenario: feedback prompt keeps its existing cadence
    Given a process-owned LangyService with Redis available
    When feedback is checked after an assistant answer
    Then it never asks before two assistant answers
    And a shown card starts a three-day per-user quiet period
    And a long conversation may ask once in another conversation
    And the cadence record expires after thirty days

  Scenario: feedback prompt is safe when Redis is unavailable
    Given a process-owned LangyService without readable Redis
    When feedback is checked or marked shown
    Then the read returns false
    And the write does not throw
