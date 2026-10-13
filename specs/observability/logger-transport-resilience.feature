@unit
Feature: A failing log export transport degrades quietly
  The dev OTLP endpoint can be down while the stack restarts. Logging must
  never block or crash the process because of it.

  Scenario: A failing transport warns once and its lines are dropped quietly
    Given the OTel log transport worker has exited
    When the process keeps logging
    Then one warning names the transport
    And no further warning is written for later failures or lines

  Scenario: The transport resumes when the endpoint returns
    Given the OTel log transport failed and the retry interval has passed
    When the process logs the next line
    Then a fresh transport worker takes the line
    And no new warning is written

  Scenario: The console honours its own level when no export is configured
    Given LOG_CONSOLE_LEVEL is warn and no OTel log export is configured
    When the process logs at debug, info and warn
    Then only the warn line reaches the console
