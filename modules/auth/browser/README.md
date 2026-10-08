# @langwatch/auth-browser

The browser half of [auth](../README.md). What a browser installs when it installs auth: the unauthenticated front-door screens, every one under the auth layout that mounts AuthHostApi.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/auth.web.ts:15` (`defineBrowserModule("auth")`), exported as `authWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                       | URL                       | Within | Label | Permission | Flags |
| ------------------------------ | ------------------------- | ------ | ----- | ---------- | ----- |
| `pages/auth/signin`            | `/auth/signin`            | –      | –     | –          | –     |
| `pages/auth/signup`            | `/auth/signup`            | –      | –     | –          | –     |
| `pages/auth/forgot-password`   | `/auth/forgot-password`   | –      | –     | –          | –     |
| `pages/auth/reset-password`    | `/auth/reset-password`    | –      | –     | –          | –     |
| `pages/auth/verify-email`      | `/auth/verify-email`      | –      | –     | –          | –     |
| `pages/auth/error`             | `/auth/error`             | –      | –     | –          | –     |
| `pages/auth/join`              | `/auth/join`              | –      | –     | –          | –     |
| `pages/auth/resume`            | `/auth/resume`            | –      | –     | –          | –     |
| `pages/auth/sso-test-complete` | `/auth/sso-test-complete` | –      | –     | –          | –     |
| `pages/invite/accept`          | `/invite/accept`          | –      | –     | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/identity-client`.
- Lends: `SsoTestSignInToken`, `PasskeyCeremoniesToken`, `TwoStepCeremoniesToken`, `SignInMethodLinkingToken`.
- Capabilities: `session`, `frontDoorTheme`, `host`.
- Config slices: `auth`.

<!-- readme:generated:end -->
