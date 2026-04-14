Feature: Online Evaluation Monitor CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage online evaluation monitors via CLI commands
  So that I can configure evaluators to run on incoming traces without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List monitors
    Given my project has monitors configured
    When I run "langwatch monitor list"
    Then I see a table of monitors with name, type, mode, status, and sample rate

  Scenario: List monitors when none exist
    Given my project has no monitors
    When I run "langwatch monitor list"
    Then I see a message indicating no monitors were found

  Scenario: Get monitor details by ID
    Given my project has a monitor named "Toxicity Check"
    When I run "langwatch monitor get <monitor-id>"
    Then I see monitor details including name, type, mode, sample rate, and level

  Scenario: Create a monitor with default settings
    When I run "langwatch monitor create 'Toxicity Check' --check-type ragas/toxicity"
    Then a new monitor is created with ON_MESSAGE mode and 100% sampling

  Scenario: Create a guardrail monitor
    When I run "langwatch monitor create 'Content Filter' --check-type ragas/toxicity --execution-mode AS_GUARDRAIL --sample 0.5"
    Then a new monitor is created as a guardrail with 50% sampling

  Scenario: Create a monitor linked to a saved evaluator
    Given my project has an evaluator with ID "eval_abc"
    When I run "langwatch monitor create 'Custom Eval' --check-type custom/my-eval --evaluator-id eval_abc"
    Then a new monitor is created linked to the evaluator

  Scenario: Update monitor to disable it
    Given my project has an enabled monitor
    When I run "langwatch monitor update <monitor-id> --enabled false"
    Then the monitor is disabled

  Scenario: Update monitor sampling rate
    Given my project has a monitor with 100% sampling
    When I run "langwatch monitor update <monitor-id> --sample 0.25"
    Then the monitor sampling rate is updated to 25%

  Scenario: Delete a monitor
    Given my project has a monitor
    When I run "langwatch monitor delete <monitor-id>"
    Then the monitor is deleted and I see confirmation

  Scenario: Output in JSON format
    Given my project has monitors configured
    When I run "langwatch monitor list --format json"
    Then I see the monitors as a JSON array
