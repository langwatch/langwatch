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
    Then every field says FILL ME
    And running the pack with a FILL ME field left fails with the code owasp_config_incomplete, the config file and the unfilled fields
    And a filled example sits beside the config for reference

  @unit
  Scenario: Empty required lists fail fast, an agent with no privileged tools still runs
    Given a filled config in Python or TypeScript
    When tools, must_never or protected_data is an empty list
    Then running the pack fails with the code owasp_config_incomplete and the empty fields
    When only privileged_tools is empty
    Then the pack runs and the privilege attack goals name every tool instead
    And the identity criterion of ASI03 is left out, since no tool grants extra privilege

  @unit
  Scenario: The skill copier leaves caches and dotfiles behind
    Given a skill folder with a __pycache__ folder, a .pyc file and a dotfile beside its templates
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
    Given the Python and TypeScript pack tests
    Then the attacker's early exit on its own score is switched off
    And a run that still ends in an attacker early exit fails as a breach

  @unit
  Scenario: The TypeScript adapter converts scenario messages to OpenAI chat messages and back
    Given a conversation with a user turn, an assistant tool call and a tool result
    When it goes through toOpenAIMessages and fromOpenAIMessages
    Then the tool call and tool result keep their ids, names and payloads
    And arguments that are invalid JSON, empty or a JSON string travel back byte for byte
