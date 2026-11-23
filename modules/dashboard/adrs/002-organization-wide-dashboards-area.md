# ADR-002: Organization-wide Dashboards area without a forced project picker

**Date:** 2026-11-20

**Amended:** 2026-11-21, after the acceptance-criteria review of langwatch/tasks#1211 and
the design prototype. Decisions 1 to 4, 6 and 7 changed; decisions 8 to 13 are new.

**Status:** Accepted (2026-11-21; product decisions D1, D3 and D5, team decisions D2 and D4)

**Behavioural contract:**
[Organization-wide Dashboards area](../specs/dashboards-organization-area.feature)

## Context

Product asked that the Dashboards area stop forcing a project in the top bar.
People want organization-level boards, because Gateway data is organization
level. A board can still belong to one project. Sharing stays Only me, Project
or Organization.

The product requirement on langwatch/tasks#1211 (19 Nov) sharpens this: a project
view is the organization-level space filtered to one project. Opening Dashboards
or Analytics inside a project shows the same organization boards, scoped to that
project, not a separate set. At the organization level the scope picker shows
only the organization. The design prototype adds the layout and
the flows: each product's sidebar lists that product's own boards, a library
lists every board by product, boards are made in a dialog and moved between
products, addresses keep working after a move, and My dashboard and Coding
agents boards follow the member.

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
where the member has `analytics:view`. The member LangWatchQL run also accepts
`projects: "all"`: the organization's live, non-governance projects where the
member holds `analytics:view`, refused above `LWQL_MAX_MEMBER_PROJECTS` (100).

A virtual key's traces may land in the organization's hidden governance project.
Project listings and the member's LangWatchQL scope leave that project out, so
without a deliberate rule an organization board cannot read Gateway traffic there.

One risk shapes the design. `seatReachesProduct` returns false for the
`DEVELOPER` role when `scopeKind` is `"organization"`. Moving Dashboards to that
scope kind would lock developer seats out.

## Decision

We will add an organization-wide Dashboards area. Every project board keeps its
owning project, so the board, widget and favourite tables do not change. New
facts (a board's home product, personal boards) are recorded as events and
folded into projections owned by the dashboard module.

1. **Anchor stays.** Every board in `DashboardsV2` keeps its owning project. For
   a board that is not in a project view (decision 8) the owning project is
   internal: it holds the widgets, decides who may edit, and is shown only as
   "owned by <project>", or "owned by another project" to a reader who cannot
   read it.
2. **New routes (amended).** Add `/dashboards` (the library),
   `/dashboards/:id`, `/dashboards/templates` and `/dashboards/curated/:id`.
   The library lists every board the member can see across the organization:
   their own `PRIVATE` boards, `PROJECT` boards of projects they can read,
   `ORGANIZATION` boards (with no project named when the owner is unreadable)
   and their personal boards. It is grouped by home product, not by project.
   The list and the id resolution are two new procedures that ask
   `organization:view` at the organization tier; the service then narrows each
   row to projects where the member holds `analytics:view`, the loaded-row
   check the existing per-project list already makes. `"dashboards"` becomes a
   reserved project slug.
3. **Open by id (amended).** `boards.resolve` answers a board's home product,
   scope, owning project and readable state from its id, with the same
   visibility rule as the list. An org-level page runs the existing board
   screen under an anchor project (the owner if readable, otherwise the first
   readable project for an `ORGANIZATION` board), so every existing
   project-routed read and write works unchanged. Creating outside a project
   view stores the board in the **store project**: the member's last-used
   project where they hold `analytics:create`, else the first such project by
   name. With no such project nothing that makes a board is offered.
4. **Addresses never change (amended).** A board made with the flag on lives at
   `/dashboards/<id>`, whatever product made it. An LLM Ops `PROJECT` board
   lives at `/:project/dashboards/<id>`, as every board made before this change
   does. No address is rewritten after a move, and every address opens any
   board the member may see, by id, in its home product's chrome. The one
   redirect sends a `PROJECT` board opened at `/dashboards/<id>` to its own
   project's address, and only when the member reads that project. Otherwise
   the page is not available and nothing names the project. There are no
   product-prefixed board routes. This differs on purpose from the prototype,
   which gives project boards the library address: here a project shows only at
   a project address, and every existing board link is a project address.
5. **Per-route "no picker" flag.** Hide the picker on the `/dashboards` routes
   with a flag on the route, not a new scope kind. Do not switch Dashboards to
   `scopeKind` `"organization"`. This is smaller and leaves
   `seatReachesProduct` untouched, so developer seats still get in. They see
   only boards from projects they can read, the same rule as today.
6. **One flag (amended; D4, 2026-11-23).** Everything ships behind the existing
   frontend flag `release_dashboards_in_every_product`, which needs
   `release_dashboards` and now defaults on. On a page with no project both are
   evaluated for the organization, and the area exists only when at least one of
   its projects has Dashboards on. While the flag is off the `/dashboards`
   addresses answer as before, only LLM Ops shows a Dashboards section, no dialog
   opens, home products are ignored so every board lists in LLM Ops, and
   personal boards are hidden but kept.
7. **Release gate.** Hide boards whose owning project has `release_dashboards`
   off. This matches what that project shows today. The gate covers the area,
   not the data: "All projects" (decision 9) still reads a readable project
   where Dashboards is off.
8. **Home products, as events (new).** Every board has a home product: LLM Ops,
   Coding agents, Gateway or Governance. Each product's sidebar lists the boards
   homed there; the library is the whole set. The home is a new fact, so it is
   an event on a `dashboard` aggregate in the dashboard module's eventing
   pipeline, folded into a projection table the module owns. An absent row
   means LLM Ops, so no backfill is needed. A board _lives in a project_ only
   when its home is LLM Ops and its scope is `PROJECT` or `PRIVATE`; every other
   board is org-level. The project view `/:project/dashboards` lists the boards
   that live in that project plus every `ORGANIZATION` board, of any home. A
   board homed outside LLM Ops cannot be `PROJECT`
   (`dashboard_home_needs_org_scope`). Moving a board changes its home only,
   never its owning project, and asks `analytics:update` there. Only the author
   may move a `PROJECT` board out of LLM Ops, and it becomes Only me in the same
   command (D3; `dashboard_scope_author_only`).
9. **"All projects" at the organization level (new; D1).** On an org-level page
   a widget whose query stores no projects reads `projects: "all"`, at most 100
   projects; the card says so above that. A project view still reads its own
   project, and a widget that names projects reads those in both. "All" leaves
   out every other member's personal project, for every caller, the
   organization admin and the public LangWatchQL "all" included. This is
   enforced once, in `LangWatchQLReadableProjectsService.listFor`. It is a
   deliberate change to the public "all": another member's personal workspace
   is theirs, and "all" should not quietly include it.
10. **Personal boards, a member-owned aggregate (new).** My dashboard (one per
    member) and the boards made in Coding agents as Only me belong to the
    member, not to a project or an organization. They are a separate
    event-sourced `personal_board` aggregate whose tenant is the member's user
    id, with their own projections registered as user-scoped models in the
    tenancy guard. The owner comes from the session, never from input; any other
    caller gets the not-found answer. A personal board stores only layout and
    queries: each widget reads the organization and project in view, so data
    never crosses organizations. Sharing one makes a normal board in the
    organization in view and closes the personal board with a `shared` event
    pointing at the new id. A personal board can move between products and stays
    personal. My dashboard cannot be deleted
    (`dashboard_default_not_deletable`). Earlier per-project My dashboards are
    kept as Only me boards; the personal one starts as a copy of the member's
    My dashboard in the current project, if any. Personal boards are deleted on
    `lw.user.erased`, and they appear in no REST, CLI or MCP answer.
11. **Gateway traces in the governance project (new; D2).** An org-level
    board's "All projects" run also reads the organization's governance
    project, limited to Gateway traffic of the virtual keys the member may read:
    the keys the Gateway Usage page shows them, minus every other member's
    personal key (`principalUserId` set), for every member, an admin included.
    It requires `gatewayUsage:view`. The server marks a run as an org-level
    dashboard run; the browser sends no such flag. The keys filter every view
    with a key column, under the member's SQL; a view with no key column reads
    no governance row, and a catalogue test fails when a view has no rule. No
    chip, card line, project list, error or response field names the
    governance project, and it does not count toward the 100-project limit. An
    outage reading the keys fails the run; only a denial reads as "no
    governance member". The per-view rule table is reviewed for security before
    any of this is built.
12. **A read-only port into the gateway (new).** Analytics reads the readable
    keys through `GatewayApi.listVirtualKeyIdsReadableInDashboards({
organizationId, userId }) -> { virtualKeyIds }`, with the narrow type
    `GatewayDashboardKeyScope = Pick<GatewayApi,
"listVirtualKeyIdsReadableInDashboards">` beside it. It is a method on
    `GatewayApi`, not a second interface, because a feature contract exposes one
    `<Feature>Api` (ADR-133, `AGENTS.md`). Its implementation applies the whole
    Gateway rule: no ids without `gatewayUsage:view`, and it throws on an authz
    or store outage. Analytics depends only on that type and the API token, and
    asks no gateway permission itself. It is the first analytics-to-gateway
    edge; the gateway's process already depends on the analytics contract, and
    the port keeps analytics off the gateway's process code. The decision lives
    here, not in an analytics ADR, because the read exists only for the
    Dashboards area.
13. **Delete and duplicate are server rules (new).** A delete that would leave
    the member no board they can see in that product in this organization is
    refused (`dashboard_last_in_product`); From LangWatch boards do not count.
    A copy keeps its home product and who sees it, is the member's, and is
    stored in the source's project when they may create there, otherwise in the
    store project. A `PROJECT` board's copy stays in its project, so it cannot be
    copied by a member who may not create there.

## Consequences

- Two expand-only migrations, each adding tables and changing none: the home
  projection, and the personal-board projections. Turning the flag off ignores
  both, so the area reads as it did before; nothing is deleted.
- Two new event-sourced aggregates. Their event names and payloads are permanent
  once written, so they are reviewed before they land.
- The server lists boards across projects and resolves a board by id; each
  project is authorised separately with `analytics:view`.
- The `release_dashboards` gate is checked per project on the server. The list
  evaluates it for each owning project and omits boards from projects where it
  is off.
- Favourites stay per project. A star set on `/dashboards` is stored against the
  board's owning project.
- A board still has a single owning project. Moving a board to another project
  is out of scope. Archiving a project hides the organization boards stored in
  it, in every product, until it is unarchived; the library and the create
  dialog name the store project so the dependency is visible.
- Edit rights on a board homed outside LLM Ops follow its hidden owning project,
  so an admin without `analytics:update` there cannot edit it.
- "All projects" runs read up to 100 projects per query, so large organizations
  see slower org-level boards.
- The governance-project read widens what a dashboard run can see. A view left
  without a rule would open the whole governance project, hence the catalogue
  test and the security review.
- The public REST, CLI and MCP surfaces keep their answers, except that "all"
  no longer includes other members' personal projects (decision 9).
- Delivery: everything lands in one pull request, as reviewable commits (D5).

## Alternatives

**B2: project-less boards.** Make `projectId` nullable on the three tables, with
an expand and contract migration. This needs organization-scoped authorisation
targets and changes to the ClickHouse tenant scope. It is larger and riskier,
and dropping the picker does not need it. Rejected. Personal boards, which
have no sensible owning project, get their own member-owned store instead
(decision 10).

**Switch Dashboards to `scopeKind` `"organization"`.** This is the smallest
change, but it locks developer seats out of Dashboards. Rejected.

**Home product as a column on `DashboardsV2`.** Smaller, but it records a new
fact by a direct write; new facts go through events and projections. Rejected.

**Owning-project data at the organization level.** An org-level board would then
show one project's data, which does not give organization-level graphs.
Rejected by D1.

**Separate flags for the sidebar section and the organization area.** More
combinations to test for one product ask. Rejected (D4).

**An anchor-project door for the list** (`analytics:view` on any readable
project) instead of `organization:view`. Kept as the fallback if
`organization:view` turns out not to reach developer or external seats.

**A second gateway interface for the key read.** Rejected: a feature contract
exposes one `<Feature>Api` (ADR-133), so the port is a method on `GatewayApi`
with a narrow `Pick` type for its one consumer.
