Feature: A connected agent is a column in the workbench

  A connected agent runs in the customer's own process: the SDK decorator
  registers the function and the platform reaches it through the relay
  (ADR-128). Agent Testing could already run simulations against it. The
  workbench could not, so the same function that a customer simulates could
  not be measured against a dataset.

  A connected agent is now a target column like any other. The column sends
  one turn per dataset row, writes the answer in the cell, and the evaluators
  of the workbench grade that answer. Two columns of the same agent with
  different parameter values compare side by side.

  Each row is its own conversation: the column sends one user message and
  keeps no session between rows, so a row never reads what another row said.

  Background:
    Given a project with a connected agent "support-agent" that is online
    And the agent declares the parameters "model" and "plan"

  @unit
  Scenario: The column reads the dataset row and answers
    Given a dataset with an "input" column
    And a connected agent column with "input" mapped to that column
    When the row runs
    Then the agent receives one user message with the row's input
    And the cell shows what the agent answered

  @unit
  Scenario: Every row is a separate conversation
    Given a connected agent column over a dataset with three rows
    When the rows run
    Then each row sends its own conversation id
    And no row carries the session of another row

  @unit
  Scenario: The declared parameters are column inputs
    Given the person adds "support-agent" as a target
    Then the column reads "input"
    And the column offers "model" and "plan" as optional inputs
    And a parameter with no value keeps the agent's own default

  @unit
  Scenario: A parameter value reaches the agent as its declared type
    Given a connected agent column with "model" set to the value "gpt-5"
    When the row runs
    Then the call carries the parameter "model" with the value "gpt-5"
    And a name the agent does not declare is not sent

  @unit
  Scenario: The answer is text, whatever shape the function returned
    Given the function answers with a message object rather than a string
    When the row runs
    Then the cell shows the message content
    And an evaluator mapped to the column output reads the same text

  @integration
  Scenario: The evaluators grade the agent's answer
    Given a connected agent column and an exact match evaluator
    When the row runs
    Then the evaluator reads the agent's answer as the column output
    And the evaluator score shows under the column

  @integration
  Scenario: Two parameter values compare side by side
    Given a connected agent column with "model" set to "gpt-5-mini"
    And a second column of the same agent with "model" set to "gpt-5"
    When the rows run
    Then each column shows the answer of its own parameter value
    And the evaluators score the two columns separately

  @integration
  Scenario: An offline agent names itself in the failure
    Given no process of "support-agent" is connected
    When the row runs
    Then the cell fails with the offline error code
    And the copy names the agent, not an unknown error

  @integration
  Scenario: A busy agent is retried before the row fails
    Given every instance of "support-agent" is busy
    When the row runs
    Then the call is tried again inside the retry budget
    And the row fails with the busy error code when the budget ends

  @integration
  Scenario: The agent's own spans join the cell's trace
    Given a connected agent column
    When the row runs
    Then the call carries the cell's trace context
    And the trace of the cell holds the spans the agent recorded

  @integration
  Scenario: Another person's development agent is refused
    Given "support-agent" is a personal development agent of another person
    When the run starts
    Then the run is refused with the owner-only error code
    And no call is sent to the agent
