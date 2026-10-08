# @langwatch/user-browser

The browser half of [user](../README.md). What a browser installs when it installs user: the personal workspace a person opens on themselves (overview, configure, sessions, pull requests, budget request) and the account's Profile and Security settings screens.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/user.web.ts:12` (`defineBrowserModule("user")`), exported as `userWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                        | URL                                     | Within   | Label    | Permission | Flags                              |
| ------------------------------- | --------------------------------------- | -------- | -------- | ---------- | ---------------------------------- |
| `pages/me/index`                | `/me`                                   | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/me/configure`            | `/me/configure`                         | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/me/pull-requests`        | `/me/pull-requests`                     | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/me/sessions`             | `/me/sessions`                          | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/me/budget/request`       | `/me/budget/request`                    | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/[project]/sessions`      | `/:project/sessions` (route table)      | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/[project]/pull-requests` | `/:project/pull-requests` (route table) | –        | –        | –          | `release_ui_ai_governance_enabled` |
| `pages/settings/profile`        | `/settings/profile`                     | settings | Profile  | –          | –                                  |
| `pages/settings/security`       | `/settings/security`                    | settings | Security | –          | –                                  |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(personalWorkspaceApi)`, tRPC contracts: `user.*`.
- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/coding-agent-client`, `@langwatch/onboarding-client`.
- Host APIs it requires: `PersonalWorkspaceHostApi`.
- Capabilities: `secureAccountNudge`, `organizationMfaGate`.

<!-- readme:generated:end -->
