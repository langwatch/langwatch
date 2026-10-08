# @langwatch/enterprise-scim-browser

The browser half of [scim](../README.md). What a browser installs when it installs scim: the connectors screen, the back office's directory sync, the overview's directory card and the Directory's status band. Always installed — scim refuses per-organization on entitlement, never by tier.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/scim.web.ts:9` (`defineBrowserModule("scim")`), exported as `scimWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                   | URL                                   | Within   | Label      | Permission   | Flags |
| ------------------------------------------ | ------------------------------------- | -------- | ---------- | ------------ | ----- |
| `pages/settings/authentication/connectors` | `/settings/authentication/connectors` | settings | Connectors | `sso:view`   | –     |
| `pages/ops/directory-sync`                 | `/ops/directory-sync` (route table)   | –        | –          | `ops:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer              | Opens                                           | Opened from |
| ------------------- | ----------------------------------------------- | ----------- |
| `provisioningSetup` | `src/ui/sections/provisioning-setup-drawer.tsx` | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/identity-client`.
- Host APIs it requires: `ScimHostApi`.
- Capabilities: `authenticationOverviewCard`, `directorySummary`.

<!-- readme:generated:end -->
