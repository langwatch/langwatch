# @langwatch/automation-browser

The browser half of [automation](../README.md). What a browser installs when it installs automation: the automations family's tabs, plus the one-click unsubscribe an email link opens.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/automation.web.ts:22` (`defineBrowserModule("automation")`), exported as `automationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                  | URL                                 | Within  | Label       | Permission      | Flags |
| ----------------------------------------- | ----------------------------------- | ------- | ----------- | --------------- | ----- |
| `pages/[project]/automations`             | `/:project/automations`             | project | Automations | `triggers:view` | –     |
| `pages/[project]/automations/automations` | `/:project/automations/automations` | project | –           | `triggers:view` | –     |
| `pages/[project]/automations/alerts`      | `/:project/automations/alerts`      | project | –           | `triggers:view` | –     |
| `pages/[project]/automations/schedules`   | `/:project/automations/schedules`   | project | –           | `triggers:view` | –     |
| `pages/[project]/automations/activity`    | `/:project/automations/activity`    | project | –           | `triggers:view` | –     |
| `pages/unsubscribe`                       | `/unsubscribe` (route table)        | –       | –           | –               | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                 | Opens                                                           | Opened from                  |
| ---------------------- | --------------------------------------------------------------- | ---------------------------- |
| `automation`           | `src/features/authoring/ui/sections/automation-drawer.tsx`      | analytics, navigation, trace |
| `editAutomationFilter` | `src/features/authoring/ui/sections/automation-drawer.tsx`      | –                            |
| `viewAutomation`       | `src/features/authoring/ui/sections/view-automation-drawer.tsx` | langy                        |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/dataset-client`, `@langwatch/trace-client`.
- Host APIs it requires: `AutomationHost`.

<!-- readme:generated:end -->
