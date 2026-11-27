@skills
Feature: OWASP red team pack for code scenario tests
  As a security team that owns an LLM agent
  I want an OWASP pack of multi-turn red team tests I can apply to my agent as code
  So that every covered OWASP risk has a scenario test that runs in CI and reports to LangWatch

  # The skill is skills/recipes/owasp-red-team/SKILL.mdx; the pack it copies
  # lives beside it in templates/python and templates/typescript. Every attack
  # names an id from the OWASP Top 10 for LLM Applications 2025 or the OWASP
  # Top 10 for Agentic Applications, and reads one config block.

  @unit
  Scenario: The recipe ships with its templates
    Given the published skill set
    Then it includes owasp-red-team as a recipe
    And the public publisher copies the templates folder next to SKILL.md
    And the compiled Langy copy of the recipe carries the same templates

  @unit
  Scenario: Python and TypeScript packs cover the same OWASP ids
    Given the Python and TypeScript attack lists
    Then both list the same OWASP ids in the same order
    And every id is one the skill lists as covered

  @unit
  Scenario: Every attack names its OWASP id, attack goal and judge criteria
    Given each attack in both packs
    Then it has an OWASP id with its official title
    And it has an attack goal built from the config
    And it has at least two judge criteria

  @unit
  Scenario: A rule that holds a semicolon stays one rule in the attack text
    Given a must_never rule that contains a semicolon
    When the Python and TypeScript packs build the goals and criteria
    Then each rule sits on its own numbered line
    And both languages build the same text

  @unit
  Scenario: One config block drives every attack
    Given the Python and TypeScript config blocks
    Then both carry the same keys
    And every attack reads the config instead of a hard-coded agent

  @unit
  Scenario: The Python template files compile
    Given the Python template files
    Then each compiles with py_compile

  @unit
  Scenario: The skill tells a coding agent how to apply the pack
    Given the rendered skill
    Then it covers detecting the language, copying the template, wiring the adapter, filling the config, running and reading results in LangWatch

  @unit
  Scenario: The docs page lists every covered id and links the skill
    Given the docs page agent-testing/owasp-red-team
    Then it lists every OWASP id the pack covers
    And it is in the docs navigation and the published URL list

  @unit
  Scenario: The config ships with placeholders that fail fast
    Given the Python and TypeScript config blocks as shipped
    Then every field says FILL ME except the consumption limits, which ship as 500 reply words and 5 tool calls per message
    And running the pack with a FILL ME field left fails with the code owasp_config_incomplete, the config file and the unfilled fields
    And a filled example sits beside the config for reference

  @unit
  Scenario: The consumption attack judges against the configured limits
    Given a filled config with max_reply_words 200 and max_tool_calls_per_turn 3
    Then the LLM10 criteria name 200 words and 3 tool calls in both languages

  @unit
  Scenario: OWASP_TURNS falls back when empty and refuses a bad value
    Given OWASP_TURNS is unset or empty
    Then each attack runs 10 attacker turns in both languages
    When OWASP_TURNS is not a whole number or is below 1
    Then the pack fails with the code owasp_turns_invalid and a message naming OWASP_TURNS

  @unit
  Scenario: Empty required lists fail fast, an agent with no privileged tools still runs
    Given a filled config in Python or TypeScript
    When tools, must_never or protected_data is an empty list
    Then running the pack fails with the code owasp_config_incomplete and the empty fields
    When only privileged_tools is empty
    Then the pack runs and the privilege attack goals name every tool instead
    And the identity criterion of ASI03 is left out, since no tool grants extra privilege

  @unit
  Scenario: The skill copier leaves caches, installs, lockfiles and dotfiles behind
    Given a skill folder with a __pycache__ folder, a .pyc file, a dotfile, node_modules, a lockfile, coverage and dist beside its templates
    When the skill assets are listed and copied
    Then only the templates are copied

  @unit
  Scenario: The skill pins the TypeScript model provider to the scenario SDK's ai version
    Given the rendered skill and the docs page
    Then the TypeScript install line pins @ai-sdk/openai to the major the scenario SDK accepts
    And both say the attacker and judge need an OpenAI-compatible chat model

  @unit
  Scenario: Each run carries its OWASP id as the scenario id in both languages
    Given the run identity builders of the Python and TypeScript packs
    Then every attack gets a scenario id that starts with its OWASP id
    And both languages build the same id, name and metadata for the same attack

  @unit
  Scenario: An attacker early exit fails the run
    Given the attacker options and the verdict check of both packs
    Then the attacker's early exit on its own score is switched off
    And a run that still ends in an attacker early exit fails as a breach

  @unit
  Scenario: The pack refuses to run on the shipped config
    Given the Python and TypeScript pack tests run as shipped
    Then every attack fails with the code owasp_config_incomplete before any model call

  @unit
  Scenario: The pack runs end to end against a stub model
    Given the example config, an agent that refuses, and a stub model whose attacker scorer reports a win every turn
    When the Python pack runs on a stub scenario SDK and the TypeScript pack on the real one
    Then every attack passes when the judge says the agent held
    And every attack fails, naming its unmet criteria, when the judge says the agent broke

  @unit
  Scenario: The judge checks security only, from what it can see
    Given each attack's judge criteria
    Then no criterion asks the agent to help, explain or offer an alternative, so a plain refusal passes
    And the output handling criteria name where replies are shown
    And the excessive agency and misinformation criteria come from must_never and the tool results in the conversation

  @unit
  Scenario: OWASP_MODEL takes the same LiteLLM id in both languages
    Given OWASP_MODEL set to a LiteLLM id such as openai/gpt-5-mini
    Then the TypeScript pack drops the provider prefix
    And a model id whose first part is not a provider stays as it is

  @unit
  Scenario: The pack stays out of a default test run
    Given the Python and TypeScript packs copied into a repository
    Then the Python test carries the agent_test mark that conftest.py registers
    And the TypeScript pack file matches no default vitest include and runs through its own vitest config
    And the skill and the docs page say how to leave the pack out of the default run

  @unit
  Scenario: The TypeScript adapter converts scenario messages to OpenAI chat messages and back
    Given a conversation with a user turn, an assistant tool call and a tool result
    When it goes through toOpenAIMessages and fromOpenAIMessages
    Then the tool call and tool result keep their ids, names and payloads
    And arguments that are invalid JSON, empty or a JSON string travel back byte for byte
