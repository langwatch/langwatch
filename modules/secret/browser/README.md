# @langwatch/secret-browser

The browser half of [secret](../README.md). What a browser installs when it installs secret: the project Secrets settings screen.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/secret.web.ts:8` (`defineBrowserModule("secret")`), exported as `secretWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                 | URL                 | Within   | Label   | Permission | Flags |
| ------------------------ | ------------------- | -------- | ------- | ---------- | ----- |
| `pages/settings/secrets` | `/settings/secrets` | settings | Secrets | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/project-client`.
- Host APIs it requires: `SecretHostApi`.

<!-- readme:generated:end -->
