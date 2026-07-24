Feature: npx @langwatch/server bootstrap
  As a developer trying LangWatch for the first time
  I want a single command to install and start everything locally
  So that I can evaluate the product without learning Docker or Helm

  Background:
    Given I have Node.js 20+ on PATH
    And I am running on macOS or Linux (x64 or arm64)

  Scenario: First run greets the user and explains what's about to happen
    When I run "npx @langwatch/server"
    Then I see a banner with the LangWatch name and version
    And I see a numbered list of phases: predeps, services, env, start
    And I am prompted to confirm before any work begins

  Scenario: The CLI exits cleanly on Ctrl+C during the prompt
    Given I am at the initial confirmation prompt
    When I press Ctrl+C
    Then the CLI exits with status 130
    And no files have been written under "~/.langwatch"

  Scenario: A second run skips the steps that are already complete
    Given I have run "npx @langwatch/server" successfully once
    When I run "npx @langwatch/server" again
    Then the predeps phase reports each predep as already installed
    And the services phase reports each service install as up-to-date
    And the env phase reports ".env exists, leaving it alone"
    And the runner starts within 10 seconds

  Scenario: Help flag shows usage and exits
    When I run "npx @langwatch/server --help"
    Then I see usage including the start, install, doctor and reset subcommands
    And the process exits with status 0

  Scenario: Version flag prints the package version and exits
    When I run "npx @langwatch/server --version"
    Then the version printed matches the version in /package.json
    And the process exits with status 0

  Scenario: Doctor subcommand reports the state of every dependency without changing anything
    When I run "npx @langwatch/server doctor"
    Then I see a table with one row per predep and one row per service
    And each row reports installed/missing and the resolved version
    And no installer is invoked

  Scenario: Reset subcommand removes "~/.langwatch" after confirmation
    When I run "npx @langwatch/server reset"
    And I confirm the destructive prompt
    Then "~/.langwatch" is deleted
    And no other files are touched

  Scenario: Reset subcommand aborts if user declines confirmation
    When I run "npx @langwatch/server reset"
    And I decline the destructive prompt
    Then "~/.langwatch" still exists
    And the process exits with status 0

  Scenario: Unsupported platform fails fast with a clear message
    Given I am running on Windows
    When I run "npx @langwatch/server"
    Then the CLI exits with status 1
    And I see "Windows is not yet supported — use WSL2 or follow docker-compose instructions at <link>"
