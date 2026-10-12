# @langwatch/notification-browser

The browser half of [notification](../README.md). What a browser installs when it installs notification: who has unsubscribed from a project's notifications, and undoing it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/notification.web.ts:9` (`defineBrowserModule("notification")`), exported as `notificationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                            | URL                            | Within   | Label              | Permission      | Flags |
| ----------------------------------- | ------------------------------ | -------- | ------------------ | --------------- | ----- |
| `pages/settings/email-suppressions` | `/settings/email-suppressions` | settings | Email Suppressions | `triggers:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `NotificationHostApi`.
- Config slices: `notification`.

<!-- readme:generated:end -->
