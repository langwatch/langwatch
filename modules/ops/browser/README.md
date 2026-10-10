# @langwatch/ops-browser

The browser half of [ops](../README.md). What a browser installs when it installs ops: the operator screens the route table addresses, and the drawers the address bar opens (`?drawer.open=<name>`), under the names the product has always used.

## How Ops is built

Ops composes `@langwatch/design-system` exports. Queries, permissions, URL state,
formatters for operational units, and mutation handlers stay in this module.
The design system owns presentation; import its public subpaths, never Chakra
or a private source path. Start with the catalogue's **Patterns/List page**,
**Patterns/Ops overview**, and **Patterns/Drawer with form**.

### A resource list

Follow [the admin list adapter](src/features/admin/ui/blocks/admin-table.tsx)
and [the users screen](src/features/admin/ui/sections/users-view.tsx).
`ListPage` supplies `PageLayout` headings/actions, skeletons, refresh status,
error/empty slots, and `Pagination`. The adapter translates Ops's existing
paging contract; the resource owns the query and resets its page when search
changes. `SearchInput` is controlled. Use `FilterChips` for named cuts and
`ListTable` with `Table` parts for columns. Operational logs use compact density
and row rules; wide tables scroll inside their own container. Row actions use
`Menu`, and the feature decides which actions the reader may see.

Do not rebuild pagination, draw a search icon inside an input, or style a bare
table. Keep API page numbering and result counts intact. Show an empty result
only after a successful read; a failed query must never mean “no work”.

### A detail drawer

Follow [the upgrade step drawer](src/features/upgrades/ui/sections/upgrade-step-drawer.tsx)
and [its detail body](src/features/upgrades/ui/sections/upgrade-step-detail.tsx).
Use `Drawer.Root`, `Content`, `Header`, `Body`, `Footer`, and `CloseTrigger`.
`DetailDrawerHeader` supplies an accessible title, entity kind, and wrapping
context. It is the same shared pattern as the SSO connection drawer; see
[entity drawer guidance](../../../packages/design-system/docs/detail-drawers.md).
`SummaryList` / `SummaryListItem` express properties as a description list.
`FormattedDate` exposes exact times; `InlineCode` identifies machine values;
`CodePreview` supplies syntax, line numbers, and copying for a checkpoint.
Use `JsonValuePreview` when a polled value needs field changes highlighted against
its previous snapshot; it preserves Ops’s pinned-state presentation. Removed
lines belong in `CodePreview` diff mode instead.
Use `ResourceRow` for related entities and `ActivityTimeline` for recorded events.

The drawer retains the module's URL key and query. Keep mutation permissions,
pending state, confirmations, and invalidations in the feature. Use the drawer's
surface and spacing defaults. Do not override its position, background, or width
with a local panel design. Long titles and summary values must wrap.

### A dashboard of figures

Follow [the dashboard](src/ui/sections/ops/ops-dashboard.screen.tsx) and
[its figures](src/features/event-store/ui/sections/stat-strip.tsx).
`PageLayout.Header` names the page and exposes actions. `StatTileGrid` arranges
headline `StatTile` cards with the existing `elevated` variant; `StatTileFigure`
keeps numerical alignment. `CompactStat` groups secondary measurements inside
a `subtle` card. Use `MeterBar` only when a value has a meaningful limit.
The loading view uses `StatTileSkeleton` before data exists. Snapshot connection
and freshness remain visible independently of the figures.

Preserve measurement meaning: throughput is per second; rolling latency samples
are distinct from time windows; the dead-letter total includes queue and outbox
work. Unknown values are unknown, never invented zeros. Healthy detail sections
stay quiet, while trouble expands with an explanation and a route to repair.

### States and tokens

- Initial loading: match the finished structure with `Skeleton`,
  `StatTileSkeleton`, or `ListPageSkeleton`. Retain valid data during refresh.
- Empty: use a design-system empty-state composition with a next step. Separate
  an empty collection from a filtered result with no matches.
- Failure: use `HandledErrorAlert` for registered domain errors and `Alert` for
  local status. Keep raw error objects out of product copy and toasts.
- Long text and narrow widths: set `minWidth={0}` on flexible children, wrap
  headings/context/actions, and scroll wide tables locally. Keep every action
  named and keyboard accessible.
- Surfaces: `bg.page` → `bg.card` → `bg.nested` → `bg.control`, paired with
  `border.card`, `border.nested`, and `border.control`. Prefer component variants
  over surface overrides. Use semantic foreground/status roles in both modes.
- Typography: `Heading` sizes and `textStyle` tokens. No raw palette steps, hex
  colours, local CSS copies of shared components, or new recipe variant names.

If presentation is generic and missing, add it to the design system with usage
metadata, relevant state stories, and behaviour coverage. A feature component
should name an Ops concept and compose those shared parts.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/ops.web.ts:11` (`defineBrowserModule("ops")`), exported as `opsWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                | URL                                              | Within   | Label   | Permission   | Flags |
| --------------------------------------- | ------------------------------------------------ | -------- | ------- | ------------ | ----- |
| `pages/settings/checkup`                | `/settings/checkup`                              | settings | Checkup | –            | –     |
| `pages/ops/index`                       | `/ops` (route table)                             | –        | –       | `ops:view`   | –     |
| `pages/ops/dejaview`                    | `/ops/dejaview` (route table)                    | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/index`        | `/ops/event-sourcing` (route table)              | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/dead-letters` | `/ops/event-sourcing/dead-letters` (route table) | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/processes`    | `/ops/event-sourcing/processes` (route table)    | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/projections`  | `/ops/event-sourcing/projections` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/subscribers`  | `/ops/event-sourcing/subscribers` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/event-sourcing/schedules`    | `/ops/event-sourcing/schedules` (route table)    | –        | –       | `ops:view`   | –     |
| `pages/ops/blobs`                       | `/ops/blobs` (route table)                       | –        | –       | `ops:view`   | –     |
| `pages/ops/feature-flags`               | `/ops/feature-flags` (route table)               | –        | –       | `ops:view`   | –     |
| `pages/ops/foundry`                     | `/ops/foundry` (route table)                     | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades`                    | `/ops/upgrades` (route table)                    | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/preview`            | `/ops/upgrades/preview` (route table)            | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/releases/[release]` | `/ops/upgrades/releases/:release` (route table)  | –        | –       | `ops:view`   | –     |
| `pages/ops/upgrades/runs/[runId]`       | `/ops/upgrades/runs/:runId` (route table)        | –        | –       | `ops:view`   | –     |
| `pages/ops/projections/[runId]`         | `/ops/projections/:runId` (route table)          | –        | –       | `ops:view`   | –     |
| `pages/ops/operators`                   | `/ops/operators` (route table)                   | –        | –       | `ops:manage` | –     |
| `pages/ops/users`                       | `/ops/users` (route table)                       | –        | –       | `ops:manage` | –     |
| `pages/ops/organizations`               | `/ops/organizations` (route table)               | –        | –       | `ops:manage` | –     |
| `pages/ops/projects`                    | `/ops/projects` (route table)                    | –        | –       | `ops:manage` | –     |
| `pages/ops/sso-connections`             | `/ops/sso-connections` (route table)             | –        | –       | `ops:manage` | –     |
| `pages/ops/identity-lookup`             | `/ops/identity-lookup` (route table)             | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/subscriptions`         | `/ops/cloud/subscriptions` (route table)         | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/licenses`              | `/ops/cloud/licenses` (route table)              | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/self-hosted-instances` | `/ops/cloud/self-hosted-instances` (route table) | –        | –       | `ops:manage` | –     |
| `pages/ops/cloud/bug-reports`           | `/ops/cloud/bug-reports` (route table)           | –        | –       | `ops:manage` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                | Opens                                                               | Opened from |
| --------------------- | ------------------------------------------------------------------- | ----------- |
| `opsGroupDetail`      | `src/features/queue/ui/sections/group-detail-drawer.tsx`            | –           |
| `opsProcessInstance`  | `src/features/event-store/ui/sections/process-instance-drawer.tsx`  | –           |
| `opsProcessInstances` | `src/features/event-store/ui/sections/process-instances-drawer.tsx` | –           |
| `opsBlobs`            | `src/features/blob-store/ui/sections/ops-blobs-drawer.tsx`          | –           |
| `opsReplay`           | `src/features/event-store/ui/sections/ops-replay-drawer.tsx`        | –           |
| `foundry`             | `src/ui/sections/ops/ops-foundry-drawer.tsx`                        | navigation  |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/enterprise-billing-client`, `@langwatch/prompt-client`.
- Host APIs it requires: `OpsHostApi`, `CheckupHostApi`.
- Capabilities: `impersonationBanner`.
- Config slices: `ops`, `rum`.

<!-- readme:generated:end -->
