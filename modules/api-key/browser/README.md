# @langwatch/api-key-browser

The browser half of [api-key](../README.md). What a browser installs when it installs api-key: the API Keys settings screen, the CLI device-flow authorize screen and the two handoff consent screens (project authorize, MCP authorize).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/api-key.web.ts:9` (`defineBrowserModule("api-key")`), exported as `apiKeyWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                  | URL                  | Within   | Label    | Permission | Flags |
| ------------------------- | -------------------- | -------- | -------- | ---------- | ----- |
| `pages/authorize`         | `/authorize`         | –        | –        | –          | –     |
| `pages/mcp/authorize`     | `/mcp/authorize`     | –        | –        | –          | –     |
| `pages/cli/auth`          | `/cli/auth`          | –        | –        | –          | –     |
| `pages/settings/api-keys` | `/settings/api-keys` | settings | API Keys | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/organization-client`, `@langwatch/project-client`.
- Host APIs it requires: `ApiKeyHostApi`, `AuthorizeHostApi`.

<!-- readme:generated:end -->
