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
