# @langwatch/authz-browser

The browser half of [authz](../README.md). What a browser installs when it installs authz: the Roles & access settings page, whose Access tab /settings/role-bindings now redirects to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/authz.web.ts:11` (`defineBrowserModule("authz")`), exported as `authzWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key               | URL               | Within   | Label          | Permission            | Flags |
| ---------------------- | ----------------- | -------- | -------------- | --------------------- | ----- |
| `pages/settings/roles` | `/settings/roles` | settings | Roles & access | `organization:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(authzApi)`, tRPC contracts: –.
- Host APIs it requires: `AuthzHostApi`.
- Config slices: `authz`.

<!-- readme:generated:end -->
