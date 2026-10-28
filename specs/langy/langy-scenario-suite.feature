Feature: Langy files a new scenario into a test suite the project already has
  As a user asking Langy for a scenario
  I want it filed in the test suite that fits
  So that a stray "default" suite does not appear

  Background: the platform files a scenario with no suite into Default.
    That default is right for a script, not for an assistant that can see the
    project's suites. The scenarios skill therefore makes Langy list the test
    suites first, then file the scenario in the one that fits, or ask the user
    which one (or whether to make a new one).

  @unit
  Scenario: Creating a scenario with no suite named lists the suites first
    Given the compiled scenarios skill Langy reads
    When its body is inspected
    Then it tells the agent to list the test suites before creating a scenario
    And it tells the agent to ask the user which test suite when none clearly fits
    And it never tells the agent to leave the suite out so the scenario lands in Default
