# LangGraph TypeScript Framework Reference

## Language & Package Manager

- **Language:** TypeScript
- **Package manager:** pnpm
- **Source extensions:** `.ts`, `.tsx`

## How to Scaffold

```bash
pnpm init
pnpm add @langchain/langgraph @langchain/core @langchain/openai
```

No dedicated CLI scaffolder. Use `pnpm init` then add LangGraph dependencies and set up TypeScript configuration.

## Source Directory Convention

`src/` for main application code.

## Test Runner

vitest

```bash
pnpm vitest run
```

## LangWatch Integration

Use the LangWatch TypeScript SDK. LangGraph.js integrates via LangChain.js callback pattern for tracing.

## Framework MCP Config

Add to `.mcp.json` to get LangGraph.js and LangChain.js documentation:

```json
{
  "langgraph-ts": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y", "mcpdoc",
      "--urls", "LangGraphJS:https://langchain-ai.github.io/langgraphjs/llms.txt LangChainJS:https://js.langchain.com/llms.txt",
      "--transport", "stdio"
    ]
  }
}
```

## Initial Setup Steps

1. `pnpm init` to create a new project
2. `pnpm add @langchain/langgraph @langchain/core @langchain/openai`
3. Set up TypeScript configuration
4. Implement the agent per user requirements
5. Run with `pnpm tsx src/index.ts`

## Key Concepts

- **StateGraph**: Define your agent's state and transitions
- **Nodes**: Functions that process state and return updates
- **Edges**: Define flow between nodes (conditional or direct)
- **Checkpointer**: Enable conversation memory and state persistence

## Core Patterns

- Use the LangGraph MCP for learning about LangGraph.js
- Use LangGraph's built-in agent capabilities (StateGraph, nodes, edges)
- Follow LangGraph's TypeScript patterns and conventions
- Leverage LangChain.js integration ecosystem

## Known Pitfalls

- Always set up TypeScript configuration before implementing
- Use StateGraph patterns for agent architecture, not freestyle code
- Consult the LangGraph MCP for up-to-date API patterns

## Resources

- Use the LangGraph MCP for up-to-date LangGraph.js documentation
