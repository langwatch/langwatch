# @langwatch/ops-browser

The browser half of [ops](../README.md). What a browser installs when it installs ops: the operator screens the route table addresses, and the drawers the address bar opens (`?drawer.open=<name>`), under the names the product has always used.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/ops.web.ts:11` (`defineBrowserModule("ops")`), exported as `opsWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                | URL                                              | Within   | Label   | Permission   | Flags |
| --------------------------------------- | ------------------------------------------------ | -------- | ------- | ------------ | ----- |
| `pages/settings/checkup`                | `/settings/checkup`                              | settings | Checkup | –            | –     |
| `pages/ops/index`                       | `/ops` (route table)                             | –        | –       | `ops:view`   | –     |
| `pages/ops/dejaview`                    | `/ops/dejaview` (route table)                    | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/index`        | `/ops/event-sourcing` (route table)              | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/dead-letters` | `/ops/event-sourcing/dead-letters` (route table) | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/processes`    | `/ops/event-sourcing/processes` (route table)    | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/projections`  | `/ops/event-sourcing/projections` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/subscribers`  | `/ops/event-sourcing/subscribers` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/schedules`    | `/ops/event-sourcing/schedules` (route table)    | –        | –       | `ops:view`   | –     |
| `pages/ops/blobs`                       | `/ops/blobs` (route table)                       | –        | –       | `ops:view`   | –     |
| `pages/ops/feature-flags`               | `/ops/feature-flags` (route table)               | –        | –       | `ops:view`   | –     |
| `pages/ops/foundry`                     | `/ops/foundry` (route table)                     | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades`                    | `/ops/upgrades` (route table)                    | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/preview`            | `/ops/upgrades/preview` (route table)            | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/releases/[release]` | `/ops/upgrades/releases/:release` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/runs/[runId]`       | `/ops/upgrades/runs/:runId` (route table)        | –        | –       | `ops:view`   | –     |
| `pages/ops/projections/[runId]`         | `/ops/projections/:runId` (route table)          | –        | –       | `ops:view`   | –     |
| `pages/ops/operators`                   | `/ops/operators` (route table)                   | –        | –       | `ops:manage` | –     |
| `pages/ops/users`                       | `/ops/users` (route table)                       | –        | –       | `ops:manage` | –     |
| `pages/ops/organizations`               | `/ops/organizations` (route table)               | –        | –       | `ops:manage` | –     |
| `pages/ops/projects`                    | `/ops/projects` (route table)                    | –        | –       | `ops:manage` | –     |
| `pages/ops/sso-connections`             | `/ops/sso-connections` (route table)             | –        | –       | `ops:manage` | –     |
| `pages/ops/identity-lookup`             | `/ops/identity-lookup` (route table)             | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/subscriptions`         | `/ops/cloud/subscriptions` (route table)         | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/licenses`              | `/ops/cloud/licenses` (route table)              | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/self-hosted-instances` | `/ops/cloud/self-hosted-instances` (route table) | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/bug-reports`           | `/ops/cloud/bug-reports` (route table)           | –        | –       | `ops:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                | Opens                                                               | Opened from |
| --------------------- | ------------------------------------------------------------------- | ----------- |
| `opsGroupDetail`      | `src/features/queue/ui/sections/group-detail-drawer.tsx`            | –           |
| `opsProcessInstance`  | `src/features/event-store/ui/sections/process-instance-drawer.tsx`  | –           |
| `opsProcessInstances` | `src/features/event-store/ui/sections/process-instances-drawer.tsx` | –           |
| `opsBlobs`            | `src/features/blob-store/ui/sections/ops-blobs-drawer.tsx`          | –           |
| `opsReplay`           | `src/features/event-store/ui/sections/ops-replay-drawer.tsx`        | –           |
| `foundry`             | `src/ui/sections/ops/ops-foundry-drawer.tsx`                        | navigation  |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/enterprise-billing-client`, `@langwatch/prompt-client`.
- Host APIs it requires: `OpsHostApi`, `CheckupHostApi`.
- Capabilities: `impersonationBanner`.
- Config slices: `ops`, `rum`.

<!-- readme:generated:end -->
