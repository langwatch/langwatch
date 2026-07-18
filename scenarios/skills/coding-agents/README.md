# Coding Agent Scenario Tests

Scenario tests for the Claude Code `coding-agents` plugin (`go-engineer`, `ts-engineer`) using the LangWatch Scenario framework.

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a `.env` file in this directory with your LangWatch API key:

   ```dotenv
   LANGWATCH_API_KEY=your_api_key_here
   ```

3. You'll also need an OpenAI API key for the judge to run:

   ```dotenv
   OPENAI_API_KEY=your_openai_key_here
   ```

4. Install and authenticate Claude Code. The tests load the plugin from this directory with `--plugin-dir` for every agent run.

Live runs are opt-in because they spawn Claude Code and call the judge model:

```bash
RUN_CODING_AGENT_SCENARIOS=1 pnpm test -- --run
```

Validate the Claude Code plugin manifest and skill layout with:

```bash
pnpm plugin:validate
```

## Running Tests

```bash
# Run all scenario tests
pnpm test

# Run in watch mode
pnpm test:watch

# Run specific test file
pnpm test src/skills-engineer.test.ts

# Open Vitest UI
pnpm test:ui
```

## Test Structure

- `src/skills-engineer.test.ts` - Scenario tests for the Go and TypeScript plugin skills
- Tests use `@langwatch/scenario` to simulate agent interactions and evaluate responses

## Configuration

- `vitest.config.ts` - Test runner configuration with long timeouts for scenario tests
- `scenario.config.mjs` - Default model configuration (gpt-5-mini)
- `tsconfig.json` - TypeScript configuration

## Related Skills

- `.claude-plugin/plugin.json` - Claude Code plugin manifest
- `skills/go-engineer/SKILL.md` - Go engineering skill using gopls
- `skills/ts-engineer/SKILL.md` - TypeScript engineering skill using tslsp-cli
