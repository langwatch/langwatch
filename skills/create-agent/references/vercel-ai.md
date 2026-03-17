# Vercel AI SDK Framework Reference

## Language & Package Manager

- **Language:** TypeScript
- **Package manager:** pnpm
- **Source extensions:** `.ts`, `.tsx`

## How to Scaffold

```bash
pnpm init
pnpm add ai @ai-sdk/openai
```

For other model providers, install the corresponding package (e.g., `@ai-sdk/anthropic`, `@ai-sdk/google`).

## Source Directory Convention

`src/` for main application code.

## Test Runner

vitest

```bash
pnpm vitest run
```

## LangWatch Integration

Use the LangWatch TypeScript SDK. Vercel AI SDK integrates via the standard TypeScript tracing pattern.

## Framework MCP Config

Add to `.mcp.json` to get Vercel AI SDK documentation:

```json
{
  "vercel-ai": {
    "type": "stdio",
    "command": "uvx",
    "args": [
      "--from", "mcpdoc", "mcpdoc",
      "--urls", "Vercel:https://ai-sdk.dev/docs/introduction",
      "--transport", "stdio"
    ]
  }
}
```

## Initial Setup Steps

1. `pnpm init` to create a new project
2. `pnpm add ai @ai-sdk/openai` (or other provider packages)
3. Set up TypeScript configuration
4. Implement the agent per user requirements
5. Run with `pnpm tsx src/index.ts` or integrate with your chosen web framework

## Key Concepts

- **Unified Provider Architecture**: Consistent interface across multiple AI model providers
- **generateText**: Generate text using any supported model
- **streamText**: Stream text responses for real-time interactions
- **Framework Integration**: Works with Next.js, React, Svelte, Vue, and Node.js

## Core Patterns

- Use the Vercel AI SDK MCP for learning about the SDK
- Use Vercel AI SDK's unified provider architecture
- Follow Vercel AI SDK's TypeScript patterns and conventions
- Leverage framework integrations (Next.js, React, Svelte, Vue, Node.js)

## Known Pitfalls

- Always set up TypeScript configuration before implementing
- Use the correct provider package for your chosen model (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.)
- Consult the Vercel AI SDK MCP for up-to-date API patterns

## Resources

- Use the AI SDK MCP for up-to-date documentation
- https://ai-sdk.dev/docs/introduction
