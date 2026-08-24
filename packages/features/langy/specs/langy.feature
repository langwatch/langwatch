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
