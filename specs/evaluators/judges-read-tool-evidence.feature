Feature: LLM judges read the tool evidence by default
  As someone running an LLM-as-judge evaluator on an agent
  I want the judge to read the tool calls and results, not only the first input and last output
  So that questions about what the agent did are decided on the evidence

  # A judge benchmark found 18 cases that every judge model answered wrong; 11
  # of them were questions ("did a tool call fail", "did the user get what they
  # asked for") decided only by a tool span, read on a view that carried none.
  # The prompt-driven judges (langevals/llm_boolean, llm_score, llm_category)
  # therefore default to the AI-readable trace or the thread's steps view. A
  # saved mapping is used as it is, so the lighter views stay an explicit choice.
  #
  # Bindings:
  #   modules/evaluation/process/src/services/__tests__/evaluation-execution.judge-defaults.unit.test.ts
  #   modules/evaluation/process/src/rules/__tests__/evaluation-render-budget.unit.test.ts
  #   modules/evaluation/process/src/services/__tests__/evaluation-span-digest.service.unit.test.ts
  #   modules/evaluator/browser/src/model/evaluations/__tests__/auto-infer-mappings.unit.test.ts

  @unit
  Scenario: An LLM judge with no saved mapping reads the whole trace
    Given an LLM judge monitor at trace level with no saved mapping
    When a trace is evaluated
    Then the judge's input is the AI-readable trace, tool calls and results included
    And the judge's output is the trace output

  # The create API and the CLI store `{}` when no mappings are sent; that used
  # to reach the judge as empty input and output, which it skipped.
  @unit
  Scenario: A monitor created with no mappings still gives its judge the trace
    Given an LLM judge monitor created with no mappings
    When a trace is evaluated
    Then the judge's input is the AI-readable trace
    And the judge's output is the trace output

  @unit
  Scenario: A thread judge with no saved mapping reads the thread's steps view
    Given an LLM judge monitor at thread level with no saved mapping
    When a trace of a thread is evaluated
    Then the judge's input is the thread's steps view, each turn with its tool calls and results

  @unit
  Scenario: Other evaluators keep the trace's own input and output
    Given a monitor for an evaluator that is not an LLM judge, with no saved mapping
    When a trace is evaluated
    Then the evaluator's input and output are the trace's own input and output
    And no trace digest is rendered

  @unit
  Scenario: A saved mapping is used as it is
    Given an LLM judge monitor whose saved mapping maps only its input to the trace input
    When a trace is evaluated
    Then the judge's input is the trace input
    And its output is empty

  @unit
  Scenario: A new online evaluation maps an LLM judge's input to the whole trace
    Given the online evaluation drawer at trace level
    When an LLM judge is picked
    Then its input maps to Full Trace (AI-Readable)
    And its output and contexts map to the trace's output and contexts

  @unit
  Scenario: A new online evaluation maps an LLM judge's input to the whole thread
    Given the online evaluation drawer at thread level
    When an LLM judge is picked
    Then its input maps to Full Thread (AI-Readable)

  @unit
  Scenario: Auto-inference keeps other evaluators on the trace's own fields
    Given the online evaluation drawer
    When an evaluator that is not an LLM judge is picked
    Then its input maps to the trace input at trace level
    And to the thread's traces at thread level

  # ---------------------------------------------------------------------------
  # Long traces and threads fit the judge instead of being skipped
  # ---------------------------------------------------------------------------

  # The render budget counts bytes over four, and a JSON-dense tool result
  # tokenises at about twice that, so half the judge's budget always fits.
  @unit
  Scenario: The render budget follows the judge's max tokens and its model's window
    Given an LLM judge whose max tokens setting is 400,000 on a model with a 1M-token window
    When a trace and a thread are rendered for it
    Then both are rendered under 200,000 estimated tokens
    And with the default setting of 128,000 they are rendered under 64,000
    And a setting larger than the model's window is capped by the window

  @unit
  Scenario: A long trace is rendered to the judge's budget instead of sent whole
    Given a trace whose digest is larger than the judge's render budget
    When the AI-readable trace is rendered for the judge
    Then it is the bounded digest under that budget, failed spans and tool calls expanded first
