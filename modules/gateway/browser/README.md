# @langwatch/gateway-browser

The browser half of [gateway](../README.md). What a browser installs when it installs gateway: the host its screens read, and the drawers the address bar opens (`?drawer.open=<name>`), under the names the product has always used.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/gateway.web.ts:11` (`defineBrowserModule("gateway")`), exported as `gatewayWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                          | URL                                       | Within | Label | Permission               | Flags                                              |
| --------------------------------- | ----------------------------------------- | ------ | ----- | ------------------------ | -------------------------------------------------- |
| `pages/gateway/virtual-keys`      | `/gateway/virtual-keys` (route table)     | –      | –     | `virtualKeys:view`       | –                                                  |
| `pages/gateway/virtual-keys/[id]` | `/gateway/virtual-keys/:id` (route table) | –      | –     | `virtualKeys:view`       | –                                                  |
| `pages/gateway/budgets`           | `/gateway/budgets` (route table)          | –      | –     | `gatewayBudgets:view`    | –                                                  |
| `pages/gateway/budgets/[id]`      | `/gateway/budgets/:id` (route table)      | –      | –     | `gatewayBudgets:view`    | –                                                  |
| `pages/gateway/routing-policies`  | `/gateway/routing-policies` (route table) | –      | –     | `routingPolicies:view`   | ≈ `FrontendFlags.release_ui_ai_governance_enabled` |
| `pages/gateway/usage`             | `/gateway/usage` (route table)            | –      | –     | `gatewayUsage:view`      | –                                                  |
| `pages/gateway/cache-rules`       | `/gateway/cache-rules` (route table)      | –      | –     | `gatewayCacheRules:view` | –                                                  |
| `pages/gateway/guardrails`        | `/gateway/guardrails` (route table)       | –      | –     | `gatewayGuardrails:view` | –                                                  |
| `pages/gateway/billing-events`    | `/gateway/billing-events` (route table)   | –      | –     | `gatewayUsage:view`      | –                                                  |
| `pages/gateway/webhooks`          | `/gateway/webhooks` (route table)         | –      | –     | –                        | –                                                  |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer             | Opens                                                                 | Opened from |
| ------------------ | --------------------------------------------------------------------- | ----------- |
| `routingPolicy`    | `src/features/routing-policies/ui/sections/routing-policy-drawer.tsx` | –           |
| `gatewayGuardrail` | `src/ui/sections/gateway/gateway-guardrails.screen.tsx`               | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/enterprise-billing-client`, `@langwatch/onboarding-client`.
- Host APIs it requires: `GatewayHostApi`.
- Config slices: `gateway`.

<!-- readme:generated:end -->
