---
name: scenario-test
description: Add agent simulation tests to your project using LangWatch Scenario. Use when the user wants to test their agent's behavior with realistic simulations, verify tool calling, or validate multi-turn conversations.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code and similar coding agents.
---

# Add Agent Simulation Tests with LangWatch Scenario

NEVER invent your own agent testing framework. Use `@langwatch/scenario` (Python: `langwatch-scenario`). The Scenario framework provides user simulation, judge-based evaluation, and multi-turn conversation testing out of the box. Do NOT build these capabilities from scratch.

## Step 1: Read the Scenario Docs

Use the LangWatch MCP to fetch the Scenario documentation:

- Call `fetch_scenario_docs` with no arguments to see the docs index
- Read the Getting Started guide for step-by-step instructions
- Read the Agent Integration guide matching the project's framework

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs directly via URLs. For Scenario docs specifically: https://langwatch.ai/scenario/llms.txt

CRITICAL: Do NOT guess how to write scenario tests. Read the actual documentation first. Different frameworks have different adapter patterns.

## Step 2: Install the Scenario SDK

For Python:
```bash
pip install langwatch-scenario pytest pytest-asyncio
# or: uv add langwatch-scenario pytest pytest-asyncio
```

For TypeScript:
```bash
npm install @langwatch/scenario vitest @ai-sdk/openai
# or: pnpm add @langwatch/scenario vitest @ai-sdk/openai
```

## Step 3: Configure the Default Model

For Python, configure at the top of your test file:
```python
import scenario

scenario.configure(default_model="openai/gpt-4.1-mini")
```

For TypeScript, create a `scenario.config.mjs` file:
```typescript
// scenario.config.mjs
import { defineConfig } from "@langwatch/scenario/config";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  defaultModel: {
    model: openai("gpt-4.1-mini"),
  },
});
```

## Step 4: Write Your First Scenario Test

Create an agent adapter that wraps your existing agent, then use `scenario.run()` with a user simulator and judge agent.

### Python Example

```python
import pytest
import scenario

scenario.configure(default_model="openai/gpt-4.1-mini")

@pytest.mark.agent_test
@pytest.mark.asyncio
async def test_agent_responds_helpfully():
    class MyAgent(scenario.AgentAdapter):
        async def call(self, input: scenario.AgentInput) -> scenario.AgentReturnTypes:
            return await my_agent(input.messages)

    result = await scenario.run(
        name="helpful response",
        description="User asks a simple question",
        agents=[
            MyAgent(),
            scenario.UserSimulatorAgent(),
            scenario.JudgeAgent(criteria=[
                "Agent provides a helpful and relevant response",
            ]),
        ],
    )
    assert result.success
```

### TypeScript Example

```typescript
import scenario, { type AgentAdapter, AgentRole } from "@langwatch/scenario";
import { describe, it, expect } from "vitest";

const myAgent: AgentAdapter = {
  role: AgentRole.AGENT,
  async call(input) {
    return await myExistingAgent(input.messages);
  },
};

describe("My Agent", () => {
  it("responds helpfully", async () => {
    const result = await scenario.run({
      name: "helpful response",
      description: "User asks a simple question",
      agents: [
        myAgent,
        scenario.userSimulatorAgent(),
        scenario.judgeAgent({ criteria: ["Agent provides a helpful response"] }),
      ],
    });
    expect(result.success).toBe(true);
  }, 30_000);
});
```

## Step 5: Set Up Environment Variables

Ensure these are in your `.env` file:
```
OPENAI_API_KEY=your-openai-key
LANGWATCH_API_KEY=your-langwatch-key  # optional, for simulation reporting
```

## Step 6: Run the Tests

For Python:
```bash
pytest -s test_my_agent.py
# or: uv run pytest -s test_my_agent.py
```

For TypeScript:
```bash
npx vitest run my-agent.test.ts
# or: pnpm vitest run my-agent.test.ts
```

## Common Mistakes

- Do NOT create your own testing framework or simulation library — use `@langwatch/scenario` (Python: `langwatch-scenario`). It already handles user simulation, judging, multi-turn conversations, and tool call verification
- Do NOT use the `platform_create_scenario` MCP tool — this skill writes test code in the project, not platform resources
- Do NOT just write regular unit tests with hardcoded inputs and outputs — use scenario simulation tests with `UserSimulatorAgent` and `JudgeAgent` for realistic multi-turn evaluation
- Always use `JudgeAgent` criteria instead of regex or word matching for evaluating agent responses — natural language criteria are more robust and meaningful than brittle pattern matching
- Do NOT forget `@pytest.mark.asyncio` and `@pytest.mark.agent_test` decorators in Python tests
- Do NOT forget to set a generous timeout (e.g., `30_000` ms) for TypeScript tests since simulations involve multiple LLM calls
- Do NOT import from made-up packages like `agent_tester`, `simulation_framework`, `langwatch.testing`, or similar — the only valid imports are `scenario` (Python) and `@langwatch/scenario` (TypeScript)
