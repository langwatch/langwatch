# @langwatch/staff-access-browser

The browser half of [staff-access](../README.md). The operator's agent access pages: `/ops/agents` enrols the coding agents that may ask for access, lists every operator's sessions and revokes them, and `/ops/agents/approve/:requestId` approves one request with a passkey. Both answer not found while the feature is off.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/staff-access.web.ts:8` (`defineBrowserModule("staff-access")`), exported as `staffAccessWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                               | URL                                            | Within | Label | Permission   | Flags |
| -------------------------------------- | ---------------------------------------------- | ------ | ----- | ------------ | ----- |
| `pages/ops/agents`                     | `/ops/agents` (route table)                    | –      | –     | `ops:manage` | –     |
| `pages/ops/agents/approve/[requestId]` | `/ops/agents/approve/:requestId` (route table) | –      | –     | `ops:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

None: no `withApi`, client package, lend, host or capability.

<!-- readme:generated:end -->
