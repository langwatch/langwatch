Feature: Langy minimal harness
  Langy's worker runs with Langy's own system prompt and a tool surface scoped
  to its role. A constraint that can live in configuration lives in
  configuration, not in prompt prose, and the prompt has an enforced size
  budget so it cannot silently grow back into a pile of per-failure rules.

  @unit
  Scenario: The system prompt is Langy's own, not a coding agent's
    When a worker is provisioned
    Then the agent configuration carries Langy's own prompt
    And the harness's built-in coding-agent prompt is not used

  @unit
  Scenario: The worker does not expose tools outside Langy's role
    When a worker is provisioned
    Then web fetching, subagent spawning, and interactive questions are denied
    And the shell, file, skill, and todo tools stay available for the role

  @unit
  Scenario: The prompt fits its size budget
    When the prompt asset is checked
    Then its size is under the enforced byte ceiling

  @unit
  Scenario: The prompt names every trace origin the platform stamps
    Given the trace origins listed in Langy's prompt
    When they are compared with the origins the platform stamps
    Then the prompt names all of them and invents none
    And an origin the prompt never learned cannot silently return zero rows
