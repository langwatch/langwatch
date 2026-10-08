# @langwatch/enterprise-sso-browser

The browser half of [sso](../README.md). What a browser installs when it installs sso: the setup journey, and the host its sections read session and scope through. Always installed — entitlement refuses per organization, a route never does.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/sso.web.ts:9` (`defineBrowserModule("sso")`), exported as `ssoWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                 | URL                                 | Within   | Label             | Permission | Flags |
| ---------------------------------------- | ----------------------------------- | -------- | ----------------- | ---------- | ----- |
| `pages/settings/authentication/provider` | `/settings/authentication/provider` | settings | Identity provider | `sso:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `SsoHostApi`.
- Capabilities: `authenticationOverviewCard`.

<!-- readme:generated:end -->
