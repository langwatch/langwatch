# Prompt

Prompt owns versioned prompt configurations, handles, custom tags, copy/sync
behaviour, and the portable interpretation of Prompt SDK metadata.

## Surfaces

- `contract/` is the browser- and server-safe Prompt vocabulary: Zod 4
  schemas, values, errors, the abstract service capability, shorthand parsing,
  and Prompt trace-attribute parsing.
- `server/` implements Prompt persistence and behaviour behind private ports.
- `web/` supplies browser-safe presentation primitives and pure display
  helpers.

The application owns page layout, React Query/tRPC and REST clients,
authentication, permissions, and bridges to other features. Compatibility
transports keep their existing tRPC procedure names and `/api/prompts` paths,
then delegate to the process-owned Prompt service.

## Journey

1. A caller validates a command with the contract and invokes the composed
   `PromptService`.
2. The service applies Prompt rules and uses its private repository adapter.
3. The adapter maps persistence rows back to portable contract values.
4. SDK trace attributes are parsed by the contract into a display-safe Prompt
   reference; Trace owns locating that reference in a trace.
5. App transports and screens map their own authentication, permissions,
   routes, responses, and UI state around these capabilities.

Prompt contracts use bare Zod 4 (`zod`) and do not import application aliases,
Prisma, tRPC, Hono, React, or environment configuration.
