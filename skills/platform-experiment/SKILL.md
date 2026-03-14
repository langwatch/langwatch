---
name: platform-experiment
description: Create an experiment to test your prompt on the LangWatch platform. Use when you want to set up prompt testing, create evaluators, and manage prompts directly on the platform without writing code.
license: MIT
compatibility: Requires LangWatch MCP with API key. Works with Claude on the web and coding agents.
---

# Create an Experiment to Test Your Prompt

This skill uses the LangWatch platform tools (via MCP) to create prompts and evaluators. You do NOT need a codebase — this is for platform-based prompt management.

NOTE: Full UI experiments and dataset creation are not yet available via MCP. This skill sets up the building blocks (prompts + evaluators) that you can then use in the platform UI.

## Step 1: Set up the LangWatch MCP

The MCP must be configured with your LangWatch API key.

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

## Step 2: Create or Update Your Prompt

Use the `platform_create_prompt` MCP tool to create a new prompt:

- Provide a name, model, and messages (system + user)
- The prompt will appear in your LangWatch project's Prompts section

Or use `platform_list_prompts` to find existing prompts and `platform_update_prompt` to modify them.

## Step 3: Create an Evaluator

Use the `platform_create_evaluator` MCP tool to set up evaluation criteria:

- First call `discover_schema` with category "evaluators" to see available evaluator types
- Create an LLM-as-judge evaluator for quality assessment
- Or create a specific evaluator type matching your use case

## Step 4: Test in the Platform

Go to https://app.langwatch.ai and:
1. Navigate to your project's Prompts section
2. Open the prompt you created
3. Use the Prompt Playground to test variations
4. Set up an experiment in the Experiments section using your prompt and evaluator

## Current Limitations

- UI experiments cannot be created via MCP yet — use the platform UI
- Datasets cannot be created via MCP yet — use the platform UI or SDK
- The MCP can create prompts and evaluators, which are the building blocks for experiments

## Common Mistakes

- This skill uses `platform_` MCP tools — do NOT write code files
- Always call `discover_schema` before creating evaluators to understand available types
- Do NOT create prompts with `langwatch prompt create` CLI — that's for code-based projects
