# @langwatch/automations

The automation domain shared across the LangWatch app, CLI, MCP server, and
web surfaces: provider definitions (Zod schemas + metadata), notification
cadences, and the Liquid notification templating engine.

Pure by construction — no database, no React, no server-only dependencies.
The Prisma enums are mirrored in `src/enums.ts`; the app's
`prismaEnumParity.unit.test.ts` pins them in lockstep.

- `.` — enums + provider vocabulary
- `./cadences` — cadence constants + helpers
- `./providers/<name>` — one provider's shared definition
- `./templating/<module>` — template engine, renderers, defaults

The React halves live in the app (`features/automations/providers`); the
server halves too (`server/app-layer/automations/providers`).
