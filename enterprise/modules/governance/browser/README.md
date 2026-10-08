# @langwatch/enterprise-governance-browser

The browser half of [governance](../README.md). What a browser installs when it installs governance: the thirteen organization-scoped screens the admin oversight dashboard routes today. Always installed, so nothing here gates itself by tier or flag.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/governance.web.ts:12` (`defineBrowserModule("governance")`), exported as `governanceWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                              | URL                         | Within | Label            | Permission | Flags |
| ----------------------------------------------------- | --------------------------- | ------ | ---------------- | ---------- | ----- |
| `pages/governance/index`                              | `/governance`               | –      | Governance       | –          | –     |
| `pages/governance/inventory.enterprise`               | `/governance/inventory`     | –      | Inventory        | –          | –     |
| `pages/governance/ingestion-source-detail.enterprise` | `/governance/inventory/:id` | –      | –                | –          | –     |
| `pages/governance/people`                             | `/governance/people`        | –      | People           | –          | –     |
| `pages/governance/agents`                             | `/governance/agents`        | –      | Agents           | –          | –     |
| `pages/governance/costs`                              | `/governance/costs`         | –      | Costs            | –          | –     |
| `pages/governance/billed`                             | `/governance/billed`        | –      | Billed           | –          | –     |
| `pages/governance/insights`                           | `/governance/insights`      | –      | Insights         | –          | –     |
| `pages/governance/analytics`                          | `/governance/analytics`     | –      | Analytics        | –          | –     |
| `pages/governance/signals`                            | `/governance/signals`       | –      | Signals & Alerts | –          | –     |
| `pages/governance/teams`                              | `/governance/teams`         | –      | Teams            | –          | –     |
| `pages/governance/teams/[id]`                         | `/governance/teams/:id`     | –      | –                | –          | –     |
| `pages/governance/users/[id]`                         | `/governance/users/:id`     | –      | –                | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                | Opens                                                      | Opened from |
| --------------------- | ---------------------------------------------------------- | ----------- |
| `addAgent`            | `src/features/agents/register-agent-drawer.tsx`            | –           |
| `addDepartment`       | `src/features/people/ui/create-department-drawer.tsx`      | –           |
| `editIngestionSource` | `src/ui/sections/governance/routed-source-edit-drawer.tsx` | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/enterprise-governance-client`, `@langwatch/model-provider-client`, `@langwatch/onboarding-client`, `@langwatch/project-client`.
- Lends: `SampleChoiceToken`.
- Host APIs it requires: `GovernanceHostApi`.

<!-- readme:generated:end -->
