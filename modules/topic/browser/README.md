# @langwatch/topic-browser

The browser half of [topic](../README.md). What a browser installs when it installs topic: the topic-clustering schedule screen.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/topic.web.ts:8` (`defineBrowserModule("topic")`), exported as `topicWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                          | URL                          | Within   | Label            | Permission       | Flags |
| --------------------------------- | ---------------------------- | -------- | ---------------- | ---------------- | ----- |
| `pages/settings/topic-clustering` | `/settings/topic-clustering` | settings | Topic Clustering | `project:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `TopicHostApi`.

<!-- readme:generated:end -->
