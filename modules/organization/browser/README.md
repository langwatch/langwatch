# @langwatch/organization-browser

The browser half of [organization](../README.md). What a browser installs when it installs organization: the Directory (members, teams, groups) and Audit Log settings screens, and the two surfaces annotation and project mount today.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/organization.web.ts:23` (`defineBrowserModule("organization")`), exported as `organizationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                        | URL                        | Within   | Label          | Permission            | Flags |
| ------------------------------- | -------------------------- | -------- | -------------- | --------------------- | ----- |
| `pages/settings/audit-log`      | `/settings/audit-log`      | settings | Audit Log      | `organization:manage` | –     |
| `pages/settings/directory`      | `/settings/directory`      | settings | Directory      | –                     | –     |
| `pages/settings/authentication` | `/settings/authentication` | settings | Authentication | `sso:view`            | –     |
| `pages/settings/teams/[team]`   | `/settings/teams/:team`    | settings | –              | `team:view`           | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer          | Opens                                       | Opened from         |
| --------------- | ------------------------------------------- | ------------------- |
| `createProject` | `src/ui/sections/create-project-drawer.tsx` | api-key, navigation |
| `editProject`   | `src/ui/sections/edit-project-drawer.tsx`   | –                   |
| `createTeam`    | `src/ui/sections/create-team-drawer.tsx`    | –                   |
| `inviteMember`  | `src/ui/sections/invite-member-drawer.tsx`  | navigation          |
| `person`        | `src/ui/sections/person-drawer.tsx`         | –                   |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(organizationApi)`, tRPC contracts: `organization.*`, `plan.*`.
- Client packages (package.json): `@langwatch/enterprise-billing-client`, `@langwatch/enterprise-licensing-client`, `@langwatch/enterprise-scim-client`, `@langwatch/identity-client`, `@langwatch/organization-client`, `@langwatch/project-client`.
- Lends: `JoinOfferToken`, `PendingJoinRequestsToken`, `ProjectDepartmentFieldToken`.
- Host APIs it requires: `OrganizationHostApi`.
- Capabilities: `scope`, `copyTargets`, `organizationFacts`, `teamAccessWaiting`.

<!-- readme:generated:end -->
