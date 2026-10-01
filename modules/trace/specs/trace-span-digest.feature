Feature: Evaluation trace digests
  Evaluations read the same span digest through Trace as the scenario judge.

  @unit
  Scenario: Evaluation digests retain captured span content and timing
    Given a captured span with input, output and millisecond timestamps
    When an evaluation asks Trace to format its spans
    Then the digest includes the span name, input, output and duration
    And the captured span remains unchanged

  @unit
  Scenario: An empty evaluation trace has the canonical empty digest
    Given a trace with no spans
    When an evaluation asks Trace to format its spans
    Then the digest states that no spans were recorded

  # Measured on a Claude Code turn (langwatch/tasks#905): a fifth of the
  # digest was attributes every span repeats, and a tool command printed 7 times.

  @unit
  Scenario: Attributes every span shares are printed once in the digest header
    Given a trace whose every span carries the same repository, user and conversation id
    When an evaluation asks Trace to format its spans
    Then those attributes are printed once, before the span tree
    And no span repeats them

  @unit
  Scenario: Token counts are printed once, under the gen_ai.usage keys
    Given an LLM span carrying its token counts under both the gen_ai.usage keys and the raw vendor keys
    When an evaluation asks Trace to format its spans
    Then each count is printed once, under its gen_ai.usage key

  @unit
  Scenario: A child span that repeats its parent's input and output prints neither
    Given a tool span with children that repeat its input, output and tool attributes
    When an evaluation asks Trace to format its spans
    Then the tool command is printed once for the tool span
    And each child names that it repeats its parent

  @unit
  Scenario: A model call prints only the messages the previous call on its model did not send
    Given a trace of an agent loop whose every model call resends the whole history
    When an evaluation asks Trace to format its spans
    Then each model call prints only its new messages and names the call that sent the rest
    And the first user message is printed once
