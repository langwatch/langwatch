# Claude Code Guidelines for LangWatch

## Package Manager

Always use `pnpm` commands, never `npx` or `npm`. This project uses pnpm workspaces.

## Common Commands

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint
pnpm run lint:fix

# Formatting
pnpm run format

# Unit tests
pnpm run test:unit

# Integration tests
pnpm run test:integration

# Build
pnpm run build

# Run a specific script
pnpm run <script-name>

# Execute a package binary
pnpm exec <binary>
```

## Project Structure

- `src/` - Main application source code
- `src/server/` - Server-side code (tRPC routers, API handlers)
- `src/components/` - React components
- `src/utils/` - Utility functions
- `prisma/` - Database schema and migrations
- `elastic/` - Elasticsearch mappings and migrations

## Cloud Environment

This project is deployed on AWS only. SSRF protection constants in `src/utils/ssrfConstants.ts` are configured for AWS - extend if deploying to other cloud providers.
