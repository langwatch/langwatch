Feature: Prompt API snippet dialog
  As someone who just wrote a prompt in LangWatch
  I want the API dialog to show code that calls THIS prompt
  So that I can paste it into my own service and have it work first time.

  # The "API" button in the prompt editor opens one dialog. Its whole job is
  # to show the two calls that matter: get the prompt, then fill in the
  # variables it declares. The prompt's handle, its tag and its variable names
  # all come from the prompt the reader has open; only the example values are
  # illustrative.
  #
  # The prompt is resolved from the API key alone. The REST family behind
  # /api/prompts authenticates with X-Auth-Token and derives the project from
  # it, and neither the Python nor the TypeScript SDK takes a project id. The
  # Go client can pin one, but only for a personal access token; the key this
  # dialog shows is the project's own, which already carries the project.

  @unit
  Scenario: The snippet calls the prompt the reader has open
    Given a prompt with the handle "support-triage"
    When I generate its snippets
    Then the Python snippet gets "support-triage"
    And the TypeScript snippet gets "support-triage"
    And the Go snippet gets "support-triage"
    And the curl snippet requests "support-triage"

  @unit
  Scenario: The dialog offers Python, TypeScript, Go and curl
    When I generate the snippets for any prompt
    Then the languages offered are Python, TypeScript, Go and curl, in that order

  @unit
  Scenario: The compile call passes the variables the prompt declares
    Given a prompt that declares the variables "customer_name" and "order_id"
    When I generate its snippets
    Then the Python compile call passes "customer_name" and "order_id"
    And the TypeScript compile call passes "customer_name" and "order_id"
    And no variable the prompt does not declare appears

  @unit
  Scenario: A variable's example value matches the type it was declared with
    Given a prompt that declares a "bool" variable, a "float" variable and a list variable
    When I generate its snippets
    Then the example values are a boolean, a number and a list, not strings

  @unit
  Scenario: A variable's example value reads like real data
    Given a prompt that declares "customer_email" and "question"
    When I generate its snippets
    Then the example values are an email address and a plausible question

  @unit
  Scenario: A prompt with no variables compiles with no arguments
    Given a prompt that declares no variables
    When I generate its snippets
    Then the Python snippet compiles with an empty argument list
    And the TypeScript snippet compiles with an empty argument list

  @unit
  Scenario: The snippet gets the prompt and compiles it, and nothing else
    When I generate the snippets for any prompt
    Then the Python snippet does not print the prompt's name, model or version
    And the TypeScript snippet does not print the prompt's name, model or version

  @unit
  Scenario: A tagged snippet asks for that tag
    Given a prompt with the handle "support-triage" deployed to the tag "production"
    When I generate its snippets for that tag
    Then every snippet asks for "support-triage:production"

  @unit
  Scenario: No snippet carries a project id
    When I generate the snippets for any prompt
    Then no snippet passes a project id

  @integration
  Scenario: The dialog is titled for what the code does
    When I open the API dialog for a prompt
    Then the title says the code gets and uses the prompt

  @integration
  Scenario: The API key is hidden until the reader asks to see it
    Given a project with an API key
    When I open the API dialog for a prompt
    Then the key in the snippet is masked
    When I choose to show the key
    Then the key in the snippet is readable

  @integration
  Scenario: Copying always takes the working snippet
    Given a project with an API key
    And the key in the snippet is masked
    When I copy the snippet
    Then the clipboard holds the snippet with the real key, not the mask

  @integration
  Scenario: Without an API key the dialog offers a route to create one
    Given a project with no API key
    When I open the API dialog for a prompt
    Then the dialog links to the API keys settings
    And the snippet cannot be copied, because it would not run
