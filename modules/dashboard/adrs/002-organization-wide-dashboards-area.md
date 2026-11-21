# ADR-002: Organization-wide Dashboards area without a forced project picker

**Date:** 2026-11-20

**Status:** Proposed

## Context

Product asked that the Dashboards area stop forcing a project in the top bar.
People want organization-level boards, because Gateway data is organization
level. A board can still belong to one project. Sharing stays Only me, Project
or Organization.

Today every board is tied to a project:

- `DashboardScope` has `PRIVATE`, `PROJECT` and `ORGANIZATION`
  (`packages/prisma-client/prisma/schema.prisma`).
- Boards (`DashboardsV2`), widgets (`DashboardWidget`) and favourites
  (`DashboardFavourite`) all carry a required `projectId`.
- An `ORGANIZATION` board keeps an owning project. It is listed in every project
  of the organization (`findBoards` in `board.service.ts`) and is read-only
  outside the owner (`getWritable` in `dashboard-access.service.ts`).
- Every route is `/:project/dashboards...` (`apps/ui/src/shell/ui-route-table.ts`).
- The top bar shows the project picker because Dashboards has `scopeKind`
  `"project"` (`modules/navigation/browser/src/model/products.ts`).

Widgets can already read several projects through `query.projects`, up to
`LWQL_MAX_WIDGET_PROJECTS`. The read is limited to projects in the organization
where the member has `analytics:view`.

One risk shapes the design. `seatReachesProduct` returns false for the
`DEVELOPER` role when `scopeKind` is `"organization"`. Moving Dashboards to that
scope kind would lock developer seats out.

## Decision

We will add an organization-wide entry to Dashboards and keep every board
anchored to an owning project. There is no schema change.

1. **Anchor stays.** Every board keeps its owning project.
2. **New routes.** Add `/dashboards` and `/dashboards/:id`. They list and open
   every board the member can see across the organization: their own `PRIVATE`
   boards, `PROJECT` boards of projects they can read, and `ORGANIZATION`
   boards. The list is grouped by project. The top bar shows no project picker.
3. **Open by id.** Opening a board resolves its owning project from the board id
   on the server. Widgets keep reading their own `query.projects`. Creating from
   `/dashboards` asks which project owns the board (default: the last used
   project) and its sharing level.
4. **Old links stay.** Keep `/:project/dashboards` as it is for now, with no
   redirects. This avoids redirect churn. Revisit once the flag is on.
5. **Per-route "no picker" flag.** Hide the picker on `/dashboards` with a flag
   on the route, not a new scope kind. Do not switch Dashboards to `scopeKind`
   `"organization"`. This is smaller and leaves `seatReachesProduct` untouched,
   so developer seats still get in. They see only boards from projects they can
   read, the same rule as today.
6. **Flag.** Ship behind a frontend feature flag, default off.
7. **Release gate.** Hide boards whose owning project has `release_dashboards`
   off. This matches what that project shows today.

## Consequences

- No data migration. Turning the flag off restores today's behaviour.
- The server needs a read that lists boards across projects. Each project is
  authorised separately with `analytics:view`.
- The server needs a board id to project resolution that applies the same
  authorisation as the project routes.
- The `release_dashboards` gate is checked per project on the server. The list
  evaluates it for each owning project and omits boards from projects where it
  is off.
- Favourites stay per project. A star set on `/dashboards` is stored against the
  board's owning project.
- A board still has a single owning project. Moving a board to another project
  is out of scope.

## Alternatives

**B2: project-less boards.** Make `projectId` nullable on the three tables, with
an expand and contract migration. This needs organization-scoped authorisation
targets and changes to the ClickHouse tenant scope. It is larger and riskier,
and dropping the picker does not need it. Rejected for now. We can revisit it if
boards with no sensible owning project become common.

**Switch Dashboards to `scopeKind` `"organization"`.** This is the smallest
change, but it locks developer seats out of Dashboards. Rejected.
