# Coding Agent Scenario Tests

Scenario tests for coding agent skills (`go-engineer`, `ts-engineer`) using the LangWatch Scenario framework.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create a `.env` file in this directory with your LangWatch API key:
   ```
   LANGWATCH_API_KEY=your_api_key_here
   ```

3. You'll also need OpenAI API key for the tests to run:
   ```
   OPENAI_API_KEY=your_openai_key_here
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

- `src/skills-engineer.test.ts` - Scenario tests for go-engineer and ts-engineer skills
- Tests use `@langwatch/scenario` to simulate agent interactions and evaluate responses

## Configuration

- `vitest.config.ts` - Test runner configuration with long timeouts for scenario tests
- `scenario.config.mjs` - Default model configuration (gpt-5-mini)
- `tsconfig.json` - TypeScript configuration

## Related Skills

- `.agents/skills/go-engineer/SKILL.md` - Go engineering skill using gopls
- `.agents/skills/ts-engineer/SKILL.md` - TypeScript engineering skill using tslsp-cli
