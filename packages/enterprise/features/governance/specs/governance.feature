Feature: Enterprise governance package boundary

  Scenario: A pull schedule is validated portably
    Given a five-field UTC cron schedule
    When the governance contract validates it
    Then runnable schedules are accepted
    And impossible schedules are rejected

  Scenario: Pull outcomes cannot regress the projected cursor
    Given a completed pull has advanced a source cursor
    When an older completion arrives later
    Then the projected cursor remains at the newer completion

  Scenario: Pulled usage keeps money lossless
    Given a provider-reported decimal USD value
    When governance prices the observation
    Then the result is an exact integer nano-USD value
    And values outside the safe JSON integer range are rejected

  Scenario: Contracts are transport independent
    Given a browser imports the governance contract root
    Then no server, Eventing, application, environment, or generated database module loads
