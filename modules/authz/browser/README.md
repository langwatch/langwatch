# @langwatch/authz-browser

The browser half of [authz](../README.md). What a browser installs when it installs authz: the Roles & access settings page, whose Access tab /settings/role-bindings now redirects to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/authz.web.ts:13` (`defineBrowserModule("authz")`), exported as `authzWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                             | URL                             | Within   | Label          | Permission            | Flags |
| ------------------------------------ | ------------------------------- | -------- | -------------- | --------------------- | ----- |
| `pages/settings/roles`               | `/settings/roles`               | settings | Roles & access | `members:view`        | –     |
| `pages/settings/braids`              | `/settings/braids`              | settings | Braids         | `project:view`        | –     |
| `pages/settings/organization-braids` | `/settings/organization-braids` | settings | Braids         | `organization:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer       | Opens                                    | Opened from |
| ------------ | ---------------------------------------- | ----------- |
| `roleDetail` | `src/ui/sections/role-detail-drawer.tsx` | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(authzApi)`, tRPC contracts: –.
- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/project-client`, `@langwatch/trace-client`.
- Host APIs it requires: `AuthzHostApi`.
- Config slices: `authz`.

<!-- readme:generated:end -->
