# @langwatch/slack-browser

The browser half of [slack](../README.md). What a browser installs for slack: the `slackConnection` drawer settings and automation open.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/slack.web.ts:5` (`defineBrowserModule("slack")`), exported as `slackWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

None.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer            | Opens                                         | Opened from                    |
| ----------------- | --------------------------------------------- | ------------------------------ |
| `slackConnection` | `src/ui/sections/slack-connection-drawer.tsx` | automation, integration, langy |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

None: no `withApi`, client package, lend, host or capability.

<!-- readme:generated:end -->
