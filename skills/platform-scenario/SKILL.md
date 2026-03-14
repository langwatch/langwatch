---
name: platform-scenario
description: Create scenario simulation tests for your agent on the LangWatch platform. Use when you want to define test scenarios with situations and criteria directly on the platform without writing code.
license: MIT
compatibility: Requires LangWatch MCP with API key. Works with Claude on the web and coding agents.
---

# Write Scenario Simulation Tests on the Platform

This skill uses the LangWatch platform tools (via MCP) to create and manage scenarios. You do NOT need a codebase — scenarios are created directly on the platform.

NOTE: If you have a codebase and want to write scenario test code, use the `scenario-test` skill instead.

## Step 1: Set up the LangWatch MCP

The MCP must be configured with your LangWatch API key.

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

## Step 2: Understand the Scenario Schema

Call `discover_schema` with category "scenarios" to understand:
- Available fields (name, situation, criteria, labels, etc.)
- How to structure your scenarios

## Step 3: Create Scenarios

Use the `platform_create_scenario` MCP tool to create test scenarios:

For each scenario, define:
- **name**: A descriptive name for the test case
- **situation**: The context and user behavior to simulate
- **criteria**: What the agent should do (list of success criteria)
- **labels**: Tags for organization (optional)

Create scenarios covering:
1. **Happy path**: Normal, expected interactions
2. **Edge cases**: Unusual inputs, unclear requests
3. **Error handling**: When things go wrong
4. **Boundary conditions**: Limits of the agent's capabilities

## Step 4: Review and Iterate

Use `platform_list_scenarios` to see all your scenarios and `platform_get_scenario` to review details. Use `platform_update_scenario` to refine them.

## Step 5: Run Simulations

Go to https://app.langwatch.ai and navigate to your project's Simulations section to run the scenarios you created.

## Common Mistakes

- This skill uses `platform_` MCP tools — do NOT write code files
- Do NOT use `fetch_scenario_docs` for SDK documentation — that's for code-based testing
- Write criteria as natural language descriptions, not regex patterns
- Create focused scenarios — each should test one specific behavior
- Always call `discover_schema` first to understand the scenario format
