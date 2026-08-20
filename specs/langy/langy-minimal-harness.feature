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
  Scenario: The worker does not expose tools the panel cannot show
    When a worker is provisioned
    Then subagent spawning and interactive questions are denied, because the
      panel has no way to show either one yet
    And the shell, file, skill, todo, and web fetching tools stay available,
      since Langy answers questions whose answers are not in LangWatch's docs

  @unit
  Scenario: The worker runs only the skills we ship it
    Given the host account has its own agent skills installed
    When a worker is provisioned
    Then the worker does not load them
    And the operator's skills stay out of Langy's system prompt and out of the
      capabilities it offers the user

  @unit
  Scenario: The harness's own built-in skill is denied by name
    Given the harness ships a built-in skill for editing its own configuration,
      which is work Langy does not do for a customer
    When a worker is provisioned
    Then that skill is denied by name
    And every skill we ship stays available, because a rule that denied all of
      them would also switch the skill tool off

  @unit
  Scenario: The prompt fits its size budget
    When the prompt asset is checked
    Then its size is under the enforced byte ceiling

  @unit
  Scenario: Every skill the prompt routes to is one the worker has
    Given the skills named in the prompt's routing table
    When each is looked for in the tree the worker is given
    Then all of them are there, so no reply can be spent calling a skill that
      was never shipped

  @unit
  Scenario: The prompt names every trace origin the platform stamps
    Given the trace origins listed in Langy's prompt
    When they are compared with the origins the platform stamps
    Then the prompt names all of them and invents none
    And an origin the prompt never learned cannot silently return zero rows
