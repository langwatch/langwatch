# Mastra Framework Reference

## Language & Package Manager

- **Language:** TypeScript
- **Package manager:** pnpm
- **Source extensions:** `.ts`, `.tsx`

## How to Scaffold

```bash
pnpm init
pnpx mastra init --default
```

Run `mastra init` right after `pnpm init`, before setting up the rest of the project. Then explore the generated structure and remove what is not needed.

## Source Directory Convention

`src/` for main application code.

## Test Runner

vitest

```bash
pnpm vitest run
```

## LangWatch Integration

Use the LangWatch TypeScript SDK. Mastra integrates via the standard TypeScript tracing pattern.

## Framework MCP Config

Add to `.mcp.json` to get Mastra documentation in your coding assistant:

```json
{
  "mastra": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@mastra/mcp-docs-server"]
  }
}
```

## Initial Setup Steps

1. `pnpm init`
2. `pnpx mastra init --default` (creates project structure)
3. Explore the generated folders, remove what is not needed
4. Implement the agent per user requirements
5. Open the UI with `pnpx mastra dev`

## Core Patterns

- Use the Mastra MCP server to learn about Mastra APIs and best practices
- Follow Mastra's TypeScript patterns and conventions
- Leverage Mastra's integration ecosystem
- Consult the MCP: "How do I [do X] in Mastra?"

## Known Pitfalls

- Always run `mastra init --default` before adding other project setup
- Use the Mastra MCP for documentation rather than relying on stale examples

## Resources

- Use the Mastra MCP for up-to-date documentation
