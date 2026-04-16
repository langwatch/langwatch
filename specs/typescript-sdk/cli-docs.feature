@cli @docs
Feature: CLI Docs Commands
  As a developer or coding agent using LangWatch from the terminal
  I want to fetch LangWatch and Scenario documentation directly via the CLI
  So that I do not have to install an MCP server or guess URLs to read the docs

  Background:
    Given the `langwatch` CLI is installed (npm install -g langwatch, or npx langwatch)

  # --- langwatch docs ---

  @unit
  Scenario: docs with no argument fetches the LangWatch llms.txt index
    When I run "langwatch docs"
    Then the CLI fetches "https://langwatch.ai/docs/llms.txt"
    And the markdown contents are written to stdout

  @unit
  Scenario: docs with a relative path appends .md and resolves under /docs
    When I run "langwatch docs integration/python/guide"
    Then the CLI fetches "https://langwatch.ai/docs/integration/python/guide.md"

  @unit
  Scenario: docs is forgiving about leading slashes
    When I run "langwatch docs /integration/python/guide"
    Then the CLI fetches "https://langwatch.ai/docs/integration/python/guide.md"

  @unit
  Scenario: docs is forgiving about a redundant docs/ prefix
    When I run "langwatch docs docs/integration/python/guide"
    Then the CLI fetches "https://langwatch.ai/docs/integration/python/guide.md"

  @unit
  Scenario: docs accepts a full URL ending in .md unchanged
    When I run "langwatch docs https://langwatch.ai/docs/prompt-management/cli.md"
    Then the CLI fetches "https://langwatch.ai/docs/prompt-management/cli.md"

  @unit
  Scenario: docs accepts a full URL without an extension and appends .md
    When I run "langwatch docs https://langwatch.ai/docs/prompt-management/cli"
    Then the CLI fetches "https://langwatch.ai/docs/prompt-management/cli.md"

  @unit
  Scenario: docs strips wrapping quotes that agents sometimes paste
    When I run `langwatch docs "integration/python/guide"`
    Then the CLI fetches "https://langwatch.ai/docs/integration/python/guide.md"

  @unit
  Scenario: docs preserves an absolute URL ending in .txt (e.g. llms.txt)
    When I run "langwatch docs https://langwatch.ai/docs/llms.txt"
    Then the CLI fetches "https://langwatch.ai/docs/llms.txt"

  # --- langwatch scenario-docs ---

  @unit
  Scenario: scenario-docs with no argument fetches the Scenario llms.txt index
    When I run "langwatch scenario-docs"
    Then the CLI fetches "https://langwatch.ai/scenario/llms.txt"

  @unit
  Scenario: scenario-docs with a relative path resolves under /scenario
    When I run "langwatch scenario-docs advanced/red-teaming"
    Then the CLI fetches "https://langwatch.ai/scenario/advanced/red-teaming.md"

  @unit
  Scenario: scenario-docs is forgiving about a redundant scenario/ prefix
    When I run "langwatch scenario-docs scenario/advanced/red-teaming"
    Then the CLI fetches "https://langwatch.ai/scenario/advanced/red-teaming.md"

  # --- error handling ---

  Scenario: Non-OK responses surface the HTTP status and exit non-zero
    Given fetching the resolved URL returns HTTP 404
    When I run "langwatch docs does/not/exist"
    Then the command exits with code 1
    And stderr mentions the HTTP status

  # --- forgiving-by-design ---

  Scenario: Coding agents that paste any URL form get the markdown back
    Given the CLI accepts urls in any format (full URL, /path, path, or quoted)
    Then the agent never has to construct URLs by hand
    And the agent does not need an MCP server to read documentation
