# @langwatch/project-browser

The browser half of [project](../README.md). What a browser installs when it installs project: the home a member lands on, and the project settings page.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/project.web.ts:9` (`defineBrowserModule("project")`), exported as `projectWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                | URL         | Within   | Label            | Permission          | Flags |
| ----------------------- | ----------- | -------- | ---------------- | ------------------- | ----- |
| `pages/[project]/index` | `/:project` | project  | Home             | –                   | –     |
| `pages/settings`        | `/settings` | settings | Project Settings | `organization:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/analytics-client`, `@langwatch/annotation-client`, `@langwatch/dataset-client`, `@langwatch/monitor-client`, `@langwatch/navigation-client`, `@langwatch/onboarding-client`, `@langwatch/organization-client`, `@langwatch/project-client`, `@langwatch/prompt-client`, `@langwatch/trace-client`, `@langwatch/workflow-client`.
- Lends: `HeroAskFieldToken`, `ProjectSwitcherToken`.
- Host APIs it requires: `ProjectHostApi`, `ProjectHomeHost`.

<!-- readme:generated:end -->
