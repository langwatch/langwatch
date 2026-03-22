@skills @testing @static-validation
Feature: Static validation tier for skills
  As a LangWatch developer
  I want structural issues in skills caught automatically before E2E tests
  So that broken skills never reach expensive scenario tests

  Background:
    Given all SKILL.md files are discovered dynamically via glob
    And validation runs without API calls or spawned processes

  # ──────────────────────────────────────────────────
  # R1: SKILL.md frontmatter validation
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Valid SKILL.md passes frontmatter validation
    Given a SKILL.md file with valid YAML frontmatter
    And the frontmatter contains "name", "description", and "user-prompt" fields
    And the "name" field matches the skill's directory name
    When static validation runs
    Then the skill passes frontmatter validation

  @unit
  Scenario: SKILL.md with missing required fields fails validation
    Given a SKILL.md file with frontmatter missing the "description" field
    When static validation runs
    Then the skill fails with an error indicating the missing field

  @unit
  Scenario: SKILL.md with mismatched name fails validation
    Given a SKILL.md file in the "tracing" directory
    And the frontmatter "name" field is "instrument"
    When static validation runs
    Then the skill fails because the name does not match the directory

  @unit
  Scenario: SKILL.md with unparseable YAML frontmatter fails validation
    Given a SKILL.md file with malformed YAML between the --- delimiters
    When static validation runs
    Then the skill fails with a YAML parse error

  @unit
  Scenario: SKILL.md with unresolved template placeholders fails validation
    Given a SKILL.md file with "{{SOME_PLACEHOLDER}}" in the body text
    When static validation runs
    Then the skill fails because unresolved placeholders were found

  # ──────────────────────────────────────────────────
  # R2: Shared reference integrity
  # ──────────────────────────────────────────────────

  @unit
  Scenario: SKILL.md with valid shared references passes validation
    Given a SKILL.md file referencing "[Setup MCP](_shared/mcp-setup.md)"
    And the file "skills/_shared/mcp-setup.md" exists
    When static validation runs
    Then the skill passes shared reference validation

  @unit
  Scenario: SKILL.md with broken shared reference fails validation
    Given a SKILL.md file referencing "[Guide](_shared/nonexistent.md)"
    And no file named "nonexistent.md" exists in any _shared/ directory
    When static validation runs
    Then the skill fails with the broken reference path and line number

  @unit
  Scenario: SKILL.md with skill-local shared reference resolves correctly
    Given a SKILL.md file in the "evaluations" directory
    And it references "[Local](_shared/local-guide.md)"
    And the file "skills/evaluations/_shared/local-guide.md" exists
    When static validation runs
    Then the skill passes shared reference validation

  # ──────────────────────────────────────────────────
  # R3: Compiled prompt freshness
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Compiled prompt matches current SKILL.md sources
    Given the compiler produces output for skill "tracing" in "platform" mode
    And the committed file "skills/_compiled/tracing.platform.txt" has the same content
    When static validation runs
    Then the compiled prompt freshness check passes

  @unit
  Scenario: Stale compiled prompt fails validation
    Given a developer edited a SKILL.md but did not regenerate compiled prompts
    And the compiler output differs from the committed file
    When static validation runs
    Then the freshness check fails indicating which compiled file is out of date

  @unit
  Scenario: Recipe skills only have docs-mode compiled prompts
    Given a recipe skill that produces only a ".docs.txt" compiled file
    When static validation runs for that recipe skill
    Then it validates the docs variant exists and is fresh
    And it does not expect a ".platform.txt" variant

  # ──────────────────────────────────────────────────
  # R4: Evaluator slug consistency
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Skill with evaluator slug and evaluator management instructions passes
    Given a SKILL.md with a code example containing evaluate("ragas/answer_relevancy", ...)
    And the skill also mentions "platform_create_evaluator"
    When static validation runs
    Then the evaluator slug consistency check passes

  @unit
  Scenario: Skill with evaluator slug but no evaluator management instructions fails
    Given a SKILL.md with a code example containing evaluate("ragas/answer_relevancy", ...)
    And the skill does not mention "platform_create_evaluator" or "platform_list_evaluators"
    When static validation runs
    Then the skill fails because evaluator setup instructions are missing

  @unit
  Scenario: Skill with placeholder evaluator slug is allowed
    Given a SKILL.md with a code example containing evaluate("your-evaluator-slug", ...)
    And the skill does not mention "platform_create_evaluator"
    When static validation runs
    Then the evaluator slug consistency check passes

  # ──────────────────────────────────────────────────
  # R5: MCP tool name validation
  # ──────────────────────────────────────────────────

  @unit
  Scenario: SKILL.md references only valid MCP tool names
    Given a SKILL.md that mentions "platform_create_evaluator" and "fetch_langwatch_docs"
    And both tool names exist in the MCP server source
    When static validation runs
    Then the MCP tool name validation passes

  @unit
  Scenario: SKILL.md with a misspelled MCP tool name fails validation
    Given a SKILL.md that mentions "platform_create_evalutor" (typo)
    And no tool by that name exists in the MCP server source
    When static validation runs
    Then the skill fails identifying the invalid tool name

  # ──────────────────────────────────────────────────
  # R6: CI integration
  # ──────────────────────────────────────────────────

  @unit
  Scenario: Static validation runs in CI without being skipped
    Given the static validation test file does not use "skipIf(isCI)"
    When CI runs the "test:static" script
    Then all static validation tests execute

  @unit
  Scenario: Static validation runs separately from E2E scenario tests
    Given "test:static" and "test:e2e" are separate package.json scripts
    When a developer runs "test:static"
    Then only static validation tests execute
    And no scenario tests or API-dependent tests run
