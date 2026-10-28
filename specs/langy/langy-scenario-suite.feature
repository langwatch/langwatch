Feature: Langy files a new scenario into a test suite the project already has
  As a user asking Langy for a scenario
  I want it filed in the test suite that fits
  So that a stray "default" suite does not appear

  Background: the platform files a scenario with no suite into Default.
    That default is right for a script, not for an assistant that can see the
    project's suites. The scenarios skill therefore makes Langy list the test
    suites first, then file the scenario in the one that fits, or ask the user
    which one (or whether to make a new one). Guided onboarding is the one
    exception: its first scenario lands in Default because a brand-new project
    has no test suite to pick yet, and both skills say so.

  @unit
  Scenario: Creating a scenario with no suite named lists the suites first
    Given the compiled scenarios skill Langy reads
    When its body is inspected
    Then its create step lists the test suites before the create command
    And the create command it shows files the scenario into a test suite
    And it tells the agent to ask the user which test suite when none clearly fits
    And it forbids creating a scenario with the test suite left out

  @unit
  Scenario: The guided-onboarding first scenario is the one Default exception both skills name
    Given the compiled scenarios and guided-onboarding skills Langy reads
    When their bodies are inspected
    Then the scenarios skill names the guided-onboarding script as the one exception
    And the guided-onboarding skill says its first scenario leaves the test suite out on purpose

  @unit
  Scenario: The connect-agent first run picks a test suite the same way
    Given the compiled connect-agent skill Langy reads
    When its first-run step is inspected
    Then it lists the test suites before it creates the scenario
    And it tells the agent to ask the user which test suite when none clearly fits
    And it names no invented test suite

  @integration
  Scenario: Langy files a scenario into the test suite that fits without being told which
    Given a project with a test suite whose name fits the scenario
    When the assistant is asked for a platform scenario without a test suite being named
    Then it lists the test suites before it creates the scenario
    And every scenario it creates names a test suite
