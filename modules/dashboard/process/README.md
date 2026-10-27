# @langwatch/dashboard-process

The server half of [dashboard](../README.md). Dashboards and the graphs and saved workbench charts on them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("dashboard").withRepositories(dashboardRepositories).withApi(DashboardModule).withTransports(dashboardRest, dashboardWidgetRest, boardRest, boardProjectRest, graphRest, savedWorkbenchChartRest, dashboardTrpcTransport, boardTrpcTransport, graphTrpcTransport, savedViewTrpcTransport, savedWorkbenchChartTrpcTransport, dashboardWidgetTrpcTransport).provideMiddlewareContext(…)`, `src/dashboard.module.ts:25`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DashboardApi`)

Flat operations a door or a peer calls once the dashboard app is composed.

Peers call these through the token, declared at `../contract/src/dashboard.api.ts:47`; nothing else in this package is public.

#### `getAll`

The Analytics Reports boards the viewer may see, in `order`: no other member's Only me board (AC199m), and no board only the Dashboards area holds (dashboards-v2.feature AC199).

```typescript
getAll(input: { projectId: string; graphCountScope: DashboardGraphCountScope; viewer?: DashboardViewer; }): Promise<DashboardSummary[]>;
```

#### `getById`

One Reports board the viewer may see, with its builder graphs.

```typescript
getById(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard & { graphs: Graph[] }>;
```

#### `create`

A Reports board: at the scope Project, with no author and no star (AC199i).

```typescript
create(input: { projectId: string; name: string }): Promise<Dashboard>;
```

#### `rename`

Refuses the id of a board only the Dashboards area holds as not found (AC199j).

```typescript
rename(input: { projectId: string; dashboardId: string; name: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `delete`

The Reports board and its charts; the Dashboards area's rows are untouched (AC199d).

```typescript
delete(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `reorder`

The legacy board `order`; written only by the REST reorder endpoint.

```typescript
reorder(input: { projectId: string; dashboardIds: string[]; viewer?: DashboardViewer; }): Promise<{ success: true }>;
```

#### `getOrCreateFirst`

The first Reports board, created on demand; empty on an aggregate that has none (ADR-177).

```typescript
getOrCreateFirst(input: { projectId: string; viewer?: DashboardViewer }): Promise<Dashboard[]>;
```

#### `findBoards`

The Dashboards area's boards the viewer may see, with `isStarred`; no Only me board for a project credential. `includeOrganization` adds the Organization boards with `ownerProject`.

```typescript
findBoards(input: { projectId: string; viewer?: DashboardViewer; includeOrganization?: boolean; }): Promise<BoardSummary[]>;
```

#### `getBoardLinks`

Where a reader opens each of these Dashboards boards, keyed by board id.

```typescript
getBoardLinks(input: { projectId: string; dashboardIds: string[]; }): Promise<Record<string, string>>;
```

#### `getBoard`

One Dashboards board the viewer may open here: the project's own, or the organization's.

```typescript
getBoard(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `createBoard`

A Dashboards board at the scope Project; `createdById` is its author, absent for a project credential. A member's own My dashboard starts starred for them, at Only me (AC160b, AC170). `dashboards_not_enabled` while `release_dashboards` is off (AC189).

```typescript
createBoard(input: { projectId: string; name: string; createdById?: string }): Promise<Dashboard>;
```

#### `updateBoard`

The board's name and description, an absent field left as it is; `dashboards_not_enabled` while `release_dashboards` is off.

```typescript
updateBoard(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; name?: string; description?: string | null; }): Promise<Dashboard>;
```

#### `deleteBoard`

The board, its widgets, every star on it and its stale legacy copy (AC199b); `dashboards_not_enabled` while `release_dashboards` is off.

```typescript
deleteBoard(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `listStarred`

The member's stars for this project, boards and templates, in their own order.

```typescript
listStarred(input: { projectId: string; userId: string }): Promise<StarredDashboard[]>;
```

#### `star`

Stars a board or a template; appends at the end, idempotent; an unknown board is not found.

```typescript
star(input: { projectId: string; userId: string; star: DashboardStar; }): Promise<{ success: true }>;
```

#### `unstar`

```typescript
unstar(input: { projectId: string; userId: string; star: DashboardStar; }): Promise<{ success: true }>;
```

#### `reorderStars`

Rewrites the member's star order from the stars given, in the order given.

```typescript
reorderStars(input: { projectId: string; userId: string; stars: DashboardStar[]; }): Promise<{ success: true }>;
```

#### `getDashboardLinks`

Where a reader opens each of these dashboards, keyed by dashboard id.

```typescript
getDashboardLinks(input: { projectId: string; dashboardIds: string[]; }): Promise<Record<string, string>>;
```

#### `setDashboardScope`

Dashboards area: the author alone changes who sees a board, in the project that owns it.

```typescript
setDashboardScope(input: { projectId: string; dashboardId: string; scope: DashboardScope; viewer: DashboardViewer; }): Promise<Dashboard>;
```

#### `getDashboardScopeImpact`

Dashboards area: how many other members starred the author's board.

```typescript
getDashboardScopeImpact(input: { projectId: string; dashboardId: string; viewer: DashboardViewer; }): Promise<DashboardScopeImpact>;
```

#### `listDashboardScopeProjects`

Dashboards area: the projects an Organization board opens under for this member.

```typescript
listDashboardScopeProjects(input: { projectId: string; dashboardId: string; viewer: DashboardViewer; }): Promise<DashboardScopeProjects>;
```

#### `getSourcePresence`

Dashboards area: whether each Flight Deck source ever recorded a row, as this member reads.

```typescript
getSourcePresence(input: { projectId: string; viewer: DashboardViewer; }): Promise<DashboardSourcePresence>;
```

#### `listGraphs`

The builder graphs the viewer may see, optionally only those on one board.

```typescript
listGraphs(input: { projectId: string; dashboardId?: string; viewer?: DashboardViewer; }): Promise<Graph[]>;
```

#### `getGraph`

```typescript
getGraph(input: { projectId: string; graphId: string; viewer?: DashboardViewer }): Promise<Graph>;
```

#### `createGraph`

```typescript
createGraph(input: { projectId: string; name: string; graph: Record<string, unknown>; filters?: Record<string, unknown>; dashboardId?: string; layout?: Partial<GraphLayout>; viewer?: DashboardViewer; }): Promise<Graph>;
```

#### `updateGraph`

```typescript
updateGraph(input: { projectId: string; graphId: string; name?: string; graph?: Record<string, unknown>; filters?: Record<string, unknown>; viewer?: DashboardViewer; }): Promise<Graph>;
```

#### `deleteGraph`

```typescript
deleteGraph(input: { projectId: string; graphId: string; viewer?: DashboardViewer; }): Promise<Graph>;
```

#### `updateGraphLayout`

```typescript
updateGraphLayout(input: { projectId: string; graphId: string; layout: GraphLayout; viewer?: DashboardViewer; }): Promise<Graph>;
```

#### `batchUpdateGraphLayouts`

```typescript
batchUpdateGraphLayouts(input: { projectId: string; layouts: { graphId: string; layout: GraphLayout }[]; viewer?: DashboardViewer; }): Promise<{ success: true }>;
```

#### `assertDashboardWidgetsEnabled`

Custom chart widgets: a third kind of card on the same grid, whose definition analytics owns and whose placement this feature stores.

```typescript
assertDashboardWidgetsEnabled(input: { projectId: string }): Promise<void>;
```

#### `listDashboardWidgets`

The project's custom chart widgets, or one board's, the organization's boards included.

```typescript
listDashboardWidgets(input: { projectId: string; dashboardId?: string; viewer?: DashboardViewer; }): Promise<DashboardWidget[]>;
```

#### `getDashboardWidget`

With `onDashboardId`, a widget on any other board, or on none, is not found.

```typescript
getDashboardWidget(input: { projectId: string; id: string; onDashboardId?: string; viewer?: DashboardViewer; }): Promise<DashboardWidget>;
```

#### `createDashboardWidget`

Placed on `dashboardId` when named, otherwise on the unplaced authoring grid.

```typescript
createDashboardWidget(input: { projectId: string; dashboardId?: string; name: string; viewer?: DashboardViewer; } & DashboardWidgetDefinitionInput): Promise<DashboardWidget>;
```

#### `updateDashboardWidget`

With `onDashboardId`, a widget on any other board, or on none, is not found.

```typescript
updateDashboardWidget(input: { projectId: string; id: string; onDashboardId?: string; name?: string; viewer?: DashboardViewer; } & Partial<DashboardWidgetDefinitionInput>): Promise<DashboardWidget>;
```

#### `assignDashboardWidgetToDashboard`

```typescript
assignDashboardWidgetToDashboard(input: { projectId: string; id: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<DashboardWidget>;
```

#### `deleteDashboardWidget`

With `onDashboardId`, a widget on any other board, or on none, is not found.

```typescript
deleteDashboardWidget(input: { projectId: string; id: string; onDashboardId?: string; viewer?: DashboardViewer; }): Promise<void>;
```

#### `updateDashboardWidgetLayout`

Moves or resizes one widget; an id naming no widget here changes nothing.

```typescript
updateDashboardWidgetLayout(input: { projectId: string; graphId: string; layout: GraphLayout; viewer?: DashboardViewer; }): Promise<{ success: true }>;
```

#### `batchUpdateDashboardWidgetLayouts`

Moves or resizes several widgets together; ids naming no widget here change nothing.

```typescript
batchUpdateDashboardWidgetLayouts(input: { projectId: string; layouts: { graphId: string; layout: GraphLayout }[]; viewer?: DashboardViewer; }): Promise<{ success: true }>;
```

#### `dashboardWidgetPlatformUrl`

The deep link back to the dashboards list for a playground widget.

```typescript
dashboardWidgetPlatformUrl(input: { projectSlug: string }): string;
```

#### `getAlertsForGraphs`

The alert automations watching a set of charts, with their secrets stripped.

```typescript
getAlertsForGraphs(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
```

#### `findAlertForGraph`

The live alert watching one chart, when one does; secrets stripped.

```typescript
findAlertForGraph(input: { projectId: string; customGraphId: string; }): Promise<Trigger | undefined>;
```

#### `isWorkbenchEnabled`

The experimental gate over the whole workbench surface, asked per request.

```typescript
isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
```

#### `listSavedWorkbenchCharts`

Every saved workbench chart in the project.

```typescript
listSavedWorkbenchCharts(input: { projectId: string; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart[]>;
```

#### `getSavedWorkbenchChart`

```typescript
getSavedWorkbenchChart(input: { projectId: string; chartId: string; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart>;
```

#### `createSavedWorkbenchChart`

For a credential that resolved its own protections, such as an API key.

```typescript
createSavedWorkbenchChart(input: { projectId: string; protections: LangWatchQLProtections; name: string; definition: unknown; id?: string; }): Promise<SavedWorkbenchChart>;
```

#### `updateSavedWorkbenchChart`

```typescript
updateSavedWorkbenchChart(input: { projectId: string; chartId: string; name?: string; definitionUpdate?: SavedWorkbenchChartDefinitionUpdate; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart>;
```

#### `createMemberSavedWorkbenchChart`

For a signed-in member, whose own protections decide what the chart may name.

```typescript
createMemberSavedWorkbenchChart(input: { projectId: string; actorId: string; name: string; definition: unknown; }): Promise<SavedWorkbenchChart>;
```

#### `updateMemberSavedWorkbenchChart`

```typescript
updateMemberSavedWorkbenchChart(input: { projectId: string; actorId: string; chartId: string; name?: string; definition?: unknown; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart>;
```

#### `deleteSavedWorkbenchChart`

```typescript
deleteSavedWorkbenchChart(input: { projectId: string; chartId: string; viewer?: DashboardViewer; }): Promise<void>;
```

#### `placeSavedWorkbenchChart`

```typescript
placeSavedWorkbenchChart(input: { projectId: string; chartId: string; dashboardId: string; gridColumn?: number; gridRow?: number; colSpan?: number; rowSpan?: number; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart>;
```

#### `unplaceSavedWorkbenchChart`

```typescript
unplaceSavedWorkbenchChart(input: { projectId: string; chartId: string; viewer?: DashboardViewer; }): Promise<SavedWorkbenchChart>;
```

#### `runSavedWorkbenchChart`

```typescript
runSavedWorkbenchChart(input: { projectId: string; chartId: string; actorId: string; timeWindow?: LangWatchQLTimeWindow; granularitySeconds?: number; onBudgetOverflow?: LangWatchQLBudgetOverflowMode; viewer?: DashboardViewer; }): Promise<LangWatchQLQueryResult>;
```

#### `listSavedViews`

```typescript
listSavedViews(input: { projectId: string; actorId: string; kind?: string; }): Promise<SavedView[]>;
```

#### `createSavedView`

```typescript
createSavedView(input: { projectId: string; actorId: string; id?: string; name: string; filters: Record<string, unknown>; query?: string; period?: SavedViewPeriod; /** Present for a personal view, absent for one shared with the project. */ personal: boolean; kind?: string; }): Promise<SavedView>;
```

#### `deleteSavedView`

```typescript
deleteSavedView(input: { projectId: string; actorId: string; viewId: string; }): Promise<SavedView>;
```

#### `renameSavedView`

```typescript
renameSavedView(input: { projectId: string; actorId: string; viewId: string; name: string; }): Promise<SavedView>;
```

#### `reorderSavedViews`

```typescript
reorderSavedViews(input: { projectId: string; actorId: string; viewIds: string[]; }): Promise<{ success: true }>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount>;
```

## REST transport

### `boardProjectRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/board-project.rest.ts:43` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | project                                  |

#### `GET /api/v1/projects/:projectId/analytics/boards` · `getApiV1ProjectsByProjectIdAnalyticsBoards`

List dashboards

Permission `analytics:view`. Declared at `src/transport/board-project.rest.ts:48`.

Answers at `/api/v1/projects/:projectId/analytics/boards`.

```typescript
// Params: boardProjectParamsSchema, ../contract/src/board-rest.schemas.ts:49
interface Params {
  projectId: string;
}
type Response = z.infer<typeof boardListSchema>; // ../contract/src/board-rest.schemas.ts:42
```

#### `GET /api/v1/projects/:projectId/analytics/boards/:dashboardId` · `getApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardId`

Get a dashboard

Permission `analytics:view`. Declared at `src/transport/board-project.rest.ts:79`.

Answers at `/api/v1/projects/:projectId/analytics/boards/:dashboardId`.

```typescript
// Params: boardParamsSchema, ../contract/src/board-rest.schemas.ts:56
interface Params {
  projectId: string;
  dashboardId: string;
}
// Response: boardResourceSchema, ../contract/src/board-rest.schemas.ts:30
interface Response {
  id: string;
  name: string;
  description: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}
```

### `boardRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/board.rest.ts:90`             |
| Base URL    | `/api/dashboards`, twin `/api/v1/dashboards` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-10-26`                                 |

#### `GET /` · `getApiDashboards`

List dashboards

Permission `analytics:view`. Declared at `src/transport/board.rest.ts:95`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-10-26`, `/api/v1/dashboards/2026-10-26`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
type Response = z.infer<typeof boardListSchema>; // ../contract/src/board-rest.schemas.ts:42
```

#### `POST /` · `postApiDashboards`

Create a dashboard

Permission `analytics:create`. Declared at `src/transport/board.rest.ts:122`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-10-26`, `/api/v1/dashboards/2026-10-26`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
// Body: createBoardSchema, ../contract/src/board-rest.schemas.ts:73
interface Body {
  name: string;
}
type Response = z.infer<typeof boardResourceSchema>; // ../contract/src/board-rest.schemas.ts:30
```

#### `GET /:dashboardId` · `getApiDashboardsByDashboardId`

Get a dashboard

Permission `analytics:view`. Declared at `src/transport/board.rest.ts:149`.

Answers at `/api/dashboards/:dashboardId`, `/api/v1/dashboards/:dashboardId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId`, `/api/v1/dashboards/2026-10-26/:dashboardId`, `/api/dashboards/latest/:dashboardId`, `/api/v1/dashboards/latest/:dashboardId`.

```typescript
// Params: boardIdParamsSchema, ../contract/src/board-rest.schemas.ts:62
interface Params {
  dashboardId: string;
}
type Response = z.infer<typeof boardResourceSchema>; // ../contract/src/board-rest.schemas.ts:30
```

#### `PATCH /:dashboardId` · `patchApiDashboardsByDashboardId`

Update a dashboard

Permission `analytics:update`. Declared at `src/transport/board.rest.ts:176`.

Answers at `/api/dashboards/:dashboardId`, `/api/v1/dashboards/:dashboardId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId`, `/api/v1/dashboards/2026-10-26/:dashboardId`, `/api/dashboards/latest/:dashboardId`, `/api/v1/dashboards/latest/:dashboardId`.

```typescript
type Params = z.infer<typeof boardIdParamsSchema>; // ../contract/src/board-rest.schemas.ts:62
// Body: updateBoardSchema, ../contract/src/board-rest.schemas.ts:87
interface Body {
  name?: string;
  description?: string | null;
}
type Response = z.infer<typeof boardResourceSchema>; // ../contract/src/board-rest.schemas.ts:30
```

#### `DELETE /:dashboardId` · `deleteApiDashboardsByDashboardId`

Delete a dashboard

Permission `analytics:delete`. Declared at `src/transport/board.rest.ts:209`.

Answers at `/api/dashboards/:dashboardId`, `/api/v1/dashboards/:dashboardId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId`, `/api/v1/dashboards/2026-10-26/:dashboardId`, `/api/dashboards/latest/:dashboardId`, `/api/v1/dashboards/latest/:dashboardId`.

```typescript
type Params = z.infer<typeof boardIdParamsSchema>; // ../contract/src/board-rest.schemas.ts:62
// Response: dashboardDeletedResponseSchema, ../contract/src/dashboard.responses.ts:115
interface Response {
  id: string;
  name: string;
}
```

#### `GET /:dashboardId/widgets` · `getApiDashboardsByDashboardIdWidgets`

List a dashboard's widgets

Permission `analytics:view`. Declared at `src/transport/board.rest.ts:247`.

Answers at `/api/dashboards/:dashboardId/widgets`, `/api/v1/dashboards/:dashboardId/widgets`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId/widgets`, `/api/v1/dashboards/2026-10-26/:dashboardId/widgets`, `/api/dashboards/latest/:dashboardId/widgets`, `/api/v1/dashboards/latest/:dashboardId/widgets`.

```typescript
type Params = z.infer<typeof boardIdParamsSchema>; // ../contract/src/board-rest.schemas.ts:62
type Response = z.infer<typeof dashboardWidgetListSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:96
```

#### `POST /:dashboardId/widgets` · `postApiDashboardsByDashboardIdWidgets`

Create a widget on a dashboard

Permission `analytics:create`. Declared at `src/transport/board.rest.ts:272`.

Answers at `/api/dashboards/:dashboardId/widgets`, `/api/v1/dashboards/:dashboardId/widgets`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId/widgets`, `/api/v1/dashboards/2026-10-26/:dashboardId/widgets`, `/api/dashboards/latest/:dashboardId/widgets`, `/api/v1/dashboards/latest/:dashboardId/widgets`.

```typescript
type Params = z.infer<typeof boardIdParamsSchema>; // ../contract/src/board-rest.schemas.ts:62
type Body = z.infer<typeof createDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:30
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `GET /:dashboardId/widgets/:widgetId` · `getApiDashboardsByDashboardIdWidgetsByWidgetId`

Get a widget on a dashboard

Permission `analytics:view`. Declared at `src/transport/board.rest.ts:308`.

Answers at `/api/dashboards/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/:dashboardId/widgets/:widgetId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/dashboards/latest/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/latest/:dashboardId/widgets/:widgetId`.

```typescript
// Params: boardWidgetParamsSchema, ../contract/src/board-rest.schemas.ts:69
interface Params {
  dashboardId: string;
  widgetId: string;
}
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `PATCH /:dashboardId/widgets/:widgetId` · `patchApiDashboardsByDashboardIdWidgetsByWidgetId`

Update a widget on a dashboard

Permission `analytics:update`. Declared at `src/transport/board.rest.ts:334`.

Answers at `/api/dashboards/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/:dashboardId/widgets/:widgetId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/dashboards/latest/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/latest/:dashboardId/widgets/:widgetId`.

```typescript
type Params = z.infer<typeof boardWidgetParamsSchema>; // ../contract/src/board-rest.schemas.ts:69
type Body = z.infer<typeof updateDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:50
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `DELETE /:dashboardId/widgets/:widgetId` · `deleteApiDashboardsByDashboardIdWidgetsByWidgetId`

Delete a widget on a dashboard

Permission `analytics:delete`. Declared at `src/transport/board.rest.ts:370`.

Answers at `/api/dashboards/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/:dashboardId/widgets/:widgetId`; also, undocumented, `/api/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/2026-10-26/:dashboardId/widgets/:widgetId`, `/api/dashboards/latest/:dashboardId/widgets/:widgetId`, `/api/v1/dashboards/latest/:dashboardId/widgets/:widgetId`.

```typescript
type Params = z.infer<typeof boardWidgetParamsSchema>; // ../contract/src/board-rest.schemas.ts:69
// Response: inline, src/transport/board.rest.ts:391
type Response = unknown;
```

### `dashboardWidgetRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/dashboard-widget.rest.ts:100` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | project                                      |

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

List dashboard widgets

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:105`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
// Params: dashboardWidgetProjectParamsSchema, ../contract/src/dashboard-widget-rest.schemas.ts:103
interface Params {
  projectId: string;
}
type Response = z.infer<typeof dashboardWidgetListSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:96
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

Create a dashboard widget

Permission `analytics:create`. Declared at `src/transport/dashboard-widget.rest.ts:131`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
type Params = z.infer<typeof dashboardWidgetProjectParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:103
type Body = z.infer<typeof createDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:30
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Get a dashboard widget

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:169`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
// Params: dashboardWidgetParamsSchema, ../contract/src/dashboard-widget-rest.schemas.ts:112
interface Params {
  projectId: string;
  widgetId: string;
}
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `PATCH /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `patchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Update a dashboard widget

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:200`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:112
type Body = z.infer<typeof updateDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:50
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard`

Add a dashboard widget to a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:240`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:112
// Body: assignDashboardWidgetToDashboardSchema, ../contract/src/dashboard-widget-rest.schemas.ts:60
interface Body {
  dashboardId: string;
}
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `DELETE /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `deleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Delete a dashboard widget

Permission `analytics:delete`. Declared at `src/transport/dashboard-widget.rest.ts:275`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:112
// Response: inline, src/transport/dashboard-widget.rest.ts:294
type Response = unknown;
```

### `dashboardRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/dashboard.rest.ts:133`  |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |
| Deprecated  | yes                                    |

#### `GET /api/v1/analytics/reports` · `getApiV1AnalyticsReports`

List all dashboards for the project with graph counts

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:142`.

Answers at `/api/v1/analytics/reports`.

```typescript
// Response: dashboardListResponseSchema, ../contract/src/dashboard.responses.ts:90
interface Response {
  data: {
    id: string;
    name: string;
    order: number;
    createdAt: unknown;
    updatedAt: unknown;
    platformUrl: string;
    graphCount: number;
  }[];
}
```

#### `POST /api/v1/analytics/reports` · `postApiV1AnalyticsReports`

Create a new dashboard

Permission `analytics:create`. Declared at `src/transport/dashboard.rest.ts:156`.

Answers at `/api/v1/analytics/reports`.

```typescript
// Body: dashboardRestNameSchema, ../contract/src/dashboard.ts:215
interface Body {
  name: string;
}
// Response: dashboardResponseSchema, ../contract/src/dashboard.responses.ts:93
interface Response {
  id: string;
  name: string;
  order: number;
  createdAt: unknown;
  updatedAt: unknown;
  platformUrl: string;
}
```

#### `PUT /api/v1/analytics/reports/reorder` · `putApiV1AnalyticsReportsReorder`

Reorder dashboards by providing an ordered list of IDs

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:171`.

Answers at `/api/v1/analytics/reports/reorder`.

```typescript
// Body: dashboardRestReorderSchema, ../contract/src/dashboard.ts:224
interface Body {
  dashboardIds: string[];
}
// Response: dashboardReorderResponseSchema, ../contract/src/dashboard.responses.ts:122
interface Response {
  success: true;
}
```

#### `GET /api/v1/analytics/reports/:reportId` · `getApiV1AnalyticsReportsByReportId`

Get a dashboard by its id, including its graphs

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:191`.

Answers at `/api/v1/analytics/reports/:reportId`.

```typescript
// Params: reportRestParamsSchema, ../contract/src/dashboard.ts:236
interface Params {
  reportId: string;
}
type Response = z.infer<typeof dashboardDetailResponseSchema>; // ../contract/src/dashboard.responses.ts:104
```

#### `PATCH /api/v1/analytics/reports/:reportId` · `patchApiV1AnalyticsReportsByReportId`

Rename a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:209`.

Answers at `/api/v1/analytics/reports/:reportId`.

```typescript
type Params = z.infer<typeof reportRestParamsSchema>; // ../contract/src/dashboard.ts:236
type Body = z.infer<typeof dashboardRestNameSchema>; // ../contract/src/dashboard.ts:215
type Response = z.infer<typeof dashboardResponseSchema>; // ../contract/src/dashboard.responses.ts:93
```

#### `DELETE /api/v1/analytics/reports/:reportId` · `deleteApiV1AnalyticsReportsByReportId`

Delete a dashboard and its graphs (hard delete, cascade)

Permission `analytics:manage`. Declared at `src/transport/dashboard.rest.ts:229`.

Answers at `/api/v1/analytics/reports/:reportId`.

```typescript
type Params = z.infer<typeof reportRestParamsSchema>; // ../contract/src/dashboard.ts:236
type Response = z.infer<typeof dashboardDeletedResponseSchema>; // ../contract/src/dashboard.responses.ts:115
```

### `graphRest`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/graph.rest.ts:36`     |
| Base URL    | `/api/graphs`, twin `/api/v1/graphs` |
| Addressing  | dated                                |
| Credential  | project                              |
| Versions    | `2026-08-07`                         |

#### `GET /` · `getApiGraphs`

List all custom graphs, optionally filtered by dashboard

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:40`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
// Query: graphRestListQuerySchema, ../contract/src/graph.ts:83
interface Query {
  dashboardId?: string;
}
type Response = z.infer<typeof graphListRestResponseSchema>; // ../contract/src/dashboard.responses.ts:149
```

#### `GET /:id` · `getApiGraphsById`

Get a custom graph by its ID

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:58`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
// Params: graphRestParamsSchema, ../contract/src/graph.ts:87
interface Params {
  id: string;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:142
```

#### `POST /` · `postApiGraphs`

Create a custom graph on a dashboard

Permission `analytics:create`. Declared at `src/transport/graph.rest.ts:70`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
// Body: graphRestCreateSchema, ../contract/src/graph.ts:100
interface Body {
  name: string;
  graph: Record<string, unknown>;
  dashboardId?: string;
  filters?: Record<string, unknown>;
  gridColumn?: number;
  gridRow?: number;
  colSpan?: number;
  rowSpan?: number;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:142
```

#### `PATCH /:id` · `patchApiGraphsById`

Update a custom graph's name, definition, or filters

Permission `analytics:update`. Declared at `src/transport/graph.rest.ts:97`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:87
// Body: graphRestUpdateSchema, ../contract/src/graph.ts:108
interface Body {
  name?: string;
  graph?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:142
```

#### `DELETE /:id` · `deleteApiGraphsById`

Delete a custom graph

Permission `analytics:manage`. Declared at `src/transport/graph.rest.ts:122`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:87
// Response: graphDeletedResponseSchema, ../contract/src/dashboard.responses.ts:159
interface Response {
  id: string;
  deleted: boolean;
}
```

### `savedWorkbenchChartRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/saved-workbench-chart.rest.ts:105` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `GET /api/v1/projects/:projectId/analytics/charts` · `getApiV1ProjectsByProjectIdAnalyticsCharts`

List saved workbench charts

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:110`.

Answers at `/api/v1/projects/:projectId/analytics/charts`.

```typescript
// Params: savedWorkbenchChartProjectParamsSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:116
interface Params {
  projectId: string;
}
type Response = z.infer<typeof savedWorkbenchChartListSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:107
```

#### `POST /api/v1/projects/:projectId/analytics/charts` · `postApiV1ProjectsByProjectIdAnalyticsCharts`

Save a workbench chart

Permission `analytics:create`. Declared at `src/transport/saved-workbench-chart.rest.ts:136`.

Answers at `/api/v1/projects/:projectId/analytics/charts`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartProjectParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:116
// Body: createSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:56
interface Body {
  name: string;
  definition?: unknown;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:98
```

#### `GET /api/v1/projects/:projectId/analytics/charts/:chartId` · `getApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Get a saved workbench chart

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:174`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
// Params: savedWorkbenchChartParamsSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:126
interface Params {
  projectId: string;
  chartId: string;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:98
```

#### `PATCH /api/v1/projects/:projectId/analytics/charts/:chartId` · `patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Update a saved workbench chart

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:208`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Body: updateSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:72
interface Body {
  name?: string;
  definition?: unknown;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:98
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Delete a saved workbench chart

Permission `analytics:delete`. Declared at `src/transport/saved-workbench-chart.rest.ts:248`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Response: inline, src/transport/saved-workbench-chart.rest.ts:271
type Response = unknown;
```

#### `PUT /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Place a saved workbench chart on a dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:293`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Body: placeSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:45
interface Body {
  dashboardId: string;
  gridColumn?: number;
  gridRow?: number;
  colSpan?: number;
  rowSpan?: number;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:98
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Remove a saved workbench chart from its dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:332`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Response: inline, src/transport/saved-workbench-chart.rest.ts:355
type Response = unknown;
```

## tRPC transport

### `boards`

Contract `../contract/src/board.trpc.ts:27`, router `src/transport/board.trpc.ts:10`.

| Procedure              | Kind     | Gate                          | Input                | Output                           |
| ---------------------- | -------- | ----------------------------- | -------------------- | -------------------------------- |
| `boards.getAll`        | query    | Permission `analytics:view`   | inline               | inline                           |
| `boards.getById`       | query    | Permission `analytics:view`   | `boardRefSchema`     | `dashboardTrpcRowSchema`         |
| `boards.create`        | mutation | Permission `analytics:create` | inline               | `dashboardTrpcRowSchema`         |
| `boards.update`        | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `boards.delete`        | mutation | Permission `analytics:delete` | `boardRefSchema`     | `dashboardTrpcRowSchema`         |
| `boards.setScope`      | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `boards.scopeImpact`   | query    | Permission `analytics:view`   | `boardRefSchema`     | `dashboardScopeImpactSchema`     |
| `boards.scopeProjects` | query    | Permission `analytics:view`   | `boardRefSchema`     | `dashboardScopeProjectsSchema`   |
| `boards.listStarred`   | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                           |
| `boards.star`          | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |
| `boards.unstar`        | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |
| `boards.reorderStars`  | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |

```typescript
// boards.getAll
// Input: inline, ../contract/src/board.trpc.ts:31
interface Input {
  projectId: string;
  includeOrganization?: boolean;
}
// Output: boardTrpcSummarySchema.array() (inline, ../contract/src/board.trpc.ts:37)

// boards.getById
// Input: boardRefSchema, ../contract/src/board.trpc.ts:25
interface Input {
  projectId: string;
  dashboardId: string;
}
// Output: dashboardTrpcRowSchema, ../contract/src/dashboard.responses.ts:58
interface Output {
  id: string;
  projectId: string;
  name: string;
  order: number;
  description: string | null;
  createdById: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  organizationId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

// boards.create
// Input: inline, ../contract/src/board.trpc.ts:44
interface Input {
  projectId: string;
  name: string;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// boards.update
// Input: inline, ../contract/src/board.trpc.ts:50
interface Input {
  projectId: string;
  dashboardId: string;
  name?: string;
  description?: string | null;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// boards.delete
type Input = z.infer<typeof boardRefSchema>; // ../contract/src/board.trpc.ts:25
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// boards.setScope
// Input: inline, ../contract/src/board.trpc.ts:65
interface Input {
  projectId: string;
  dashboardId: string;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// boards.scopeImpact
type Input = z.infer<typeof boardRefSchema>; // ../contract/src/board.trpc.ts:25
// Output: dashboardScopeImpactSchema, ../contract/src/dashboard.ts:117
interface Output {
  otherStars: number;
}

// boards.scopeProjects
type Input = z.infer<typeof boardRefSchema>; // ../contract/src/board.trpc.ts:25
// Output: dashboardScopeProjectsSchema, ../contract/src/dashboard.ts:128
interface Output {
  ownerProject: {
    id: string;
    name: string;
    slug: string;
  };
  projects: {
    id: string;
    name: string;
    slug: string;
  }[];
}

// boards.listStarred
// Input: projectScopeSchema, ../contract/src/board.trpc.ts:24
interface Input {
  projectId: string;
}
// Output: starredDashboardSchema.array() (inline, ../contract/src/board.trpc.ts:81)

// boards.star
// Input: inline, ../contract/src/board.trpc.ts:85
interface Input {
  projectId: string;
  star:
    | {
        kind: "board";
        dashboardId: string;
      }
    | {
        kind: "template";
        templateId: string;
      };
}
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:122

// boards.unstar
// Input: inline, ../contract/src/board.trpc.ts:89
interface Input {
  projectId: string;
  star:
    | {
        kind: "board";
        dashboardId: string;
      }
    | {
        kind: "template";
        templateId: string;
      };
}
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:122

// boards.reorderStars
// Input: z.object({ ...projectScopeSchema.shape, stars: z.array(dashboardStarSchema) }) (inline, ../contract/src/board.trpc.ts:94)
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:122
```

### `dashboardWidgets`

Contract `../contract/src/dashboard-widget.trpc.ts:81`, router `src/transport/dashboard-widget.trpc.ts:34`.

| Procedure                             | Kind     | Gate                          | Input  | Output                             |
| ------------------------------------- | -------- | ----------------------------- | ------ | ---------------------------------- |
| `dashboardWidgets.list`               | query    | Permission `analytics:view`   | inline | inline                             |
| `dashboardWidgets.create`             | mutation | Permission `analytics:create` | inline | `dashboardWidgetTrpcSchema`        |
| `dashboardWidgets.update`             | mutation | Permission `analytics:update` | inline | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.updateLayout`       | mutation | Permission `analytics:update` | inline | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.batchUpdateLayouts` | mutation | Permission `analytics:update` | inline | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.assignDashboard`    | mutation | Permission `analytics:update` | inline | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.delete`             | mutation | Permission `analytics:delete` | inline | `dashboardWidgetTrpcSuccessSchema` |

```typescript
// dashboardWidgets.list
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:87
interface Input {
  projectId: string;
  dashboardId?: string;
}
// Output: dashboardWidgetTrpcRowSchema.array() (inline, ../contract/src/dashboard-widget.trpc.ts:88)

// dashboardWidgets.create
// Input: z.object({ ...projectScopeSchema.shape, dashboardId: z.string().optional(), name: dashboa… (inline, ../contract/src/dashboard-widget.trpc.ts:92)
type Output = z.infer<typeof dashboardWidgetTrpcSchema>; // ../contract/src/dashboard-widget.trpc.ts:56

// dashboardWidgets.update
// Input: z.object({ ...projectScopeSchema.shape, id: z.string(), name: dashboardWidgetNameSchema.o… (inline, ../contract/src/dashboard-widget.trpc.ts:107)
// Output: dashboardWidgetTrpcSuccessSchema, ../contract/src/dashboard-widget.trpc.ts:79
interface Output {
  success: true;
}

// dashboardWidgets.updateLayout
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:121
interface Input {
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  projectId: string;
  graphId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:79

// dashboardWidgets.batchUpdateLayouts
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:133
interface Input {
  projectId: string;
  layouts: {
    graphId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }[];
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:79

// dashboardWidgets.assignDashboard
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:141
interface Input {
  projectId: string;
  id: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:79

// dashboardWidgets.delete
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:145
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:79
```

### `dashboards`

Contract `../contract/src/dashboard.trpc.ts:23`, router `src/transport/dashboard.trpc.ts:10`.

| Procedure                      | Kind     | Gate                          | Input                | Output                           |
| ------------------------------ | -------- | ----------------------------- | -------------------- | -------------------------------- |
| `dashboards.getAll`            | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                           |
| `dashboards.getById`           | query    | Permission `analytics:view`   | `dashboardRefSchema` | `dashboardTrpcDetailSchema`      |
| `dashboards.create`            | mutation | Permission `analytics:create` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.rename`            | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.delete`            | mutation | Permission `analytics:delete` | `dashboardRefSchema` | `dashboardTrpcRowSchema`         |
| `dashboards.reorderDashboards` | mutation | Permission `analytics:update` | inline               | `dashboardReorderResponseSchema` |
| `dashboards.getOrCreateFirst`  | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                           |
| `dashboards.sourcePresence`    | query    | Permission `analytics:view`   | `projectScopeSchema` | `dashboardSourcePresenceSchema`  |

```typescript
// dashboards.getAll
// Input: projectScopeSchema, ../contract/src/dashboard.trpc.ts:17
interface Input {
  projectId: string;
}
// Output: dashboardTrpcSummarySchema.array() (inline, ../contract/src/dashboard.trpc.ts:31)

// dashboards.getById
// Input: dashboardRefSchema, ../contract/src/dashboard.trpc.ts:18
interface Input {
  projectId: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardTrpcDetailSchema>; // ../contract/src/dashboard.responses.ts:55

// dashboards.create
// Input: inline, ../contract/src/dashboard.trpc.ts:38
interface Input {
  projectId: string;
  name: string;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// dashboards.rename
// Input: inline, ../contract/src/dashboard.trpc.ts:42
interface Input {
  projectId: string;
  dashboardId: string;
  name: string;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// dashboards.delete
type Input = z.infer<typeof dashboardRefSchema>; // ../contract/src/dashboard.trpc.ts:18
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:58

// dashboards.reorderDashboards
// Input: inline, ../contract/src/dashboard.trpc.ts:52
interface Input {
  projectId: string;
  dashboardIds: string[];
}
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:122

// dashboards.getOrCreateFirst
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/dashboard.trpc.ts:17
// Output: inline, ../contract/src/dashboard.trpc.ts:58
type Output = {
  id: string;
  projectId: string;
  name: string;
  order: number;
  description: string | null;
  createdById: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  organizationId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
} | null;

// dashboards.sourcePresence
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/dashboard.trpc.ts:17
// Output: dashboardSourcePresenceSchema, ../contract/src/dashboard.ts:206
interface Output {
  traces: "present" | "absent" | "failed";
  scenarios: "present" | "absent" | "failed";
  judges: "present" | "absent" | "failed";
  feedback: "present" | "absent" | "failed";
  gateway: "present" | "absent" | "failed";
  codingAgents: "present" | "absent" | "failed";
}
```

### `graphs`

Contract `../contract/src/graph.trpc.ts:180`, router `src/transport/graph.trpc.ts:31`.

| Procedure                   | Kind     | Gate                          | Input                                   | Output                      |
| --------------------------- | -------- | ----------------------------- | --------------------------------------- | --------------------------- |
| `graphs.create`             | mutation | Permission `analytics:create` | `graphApiCreateInputSchema`             | `legacyGraphSchema`         |
| `graphs.getAll`             | query    | Permission `analytics:view`   | `graphApiListInputSchema`               | inline                      |
| `graphs.delete`             | mutation | Permission `analytics:delete` | `graphApiGraphInputSchema`              | `legacyGraphSchema`         |
| `graphs.getById`            | query    | Permission `analytics:view`   | `graphApiGraphInputSchema`              | `graphDetailSchema`         |
| `graphs.updateById`         | mutation | Permission `analytics:update` | `graphApiUpdateInputSchema`             | `legacyGraphSchema`         |
| `graphs.updateLayout`       | mutation | Permission `analytics:update` | `graphApiUpdateLayoutInputSchema`       | `legacyGraphSchema`         |
| `graphs.batchUpdateLayouts` | mutation | Permission `analytics:update` | `graphApiBatchUpdateLayoutsInputSchema` | `graphLayoutsUpdatedSchema` |

```typescript
// graphs.create
// Input: graphApiCreateInputSchema, ../contract/src/graph.trpc.ts:49
interface Input {
  projectId: string;
  name: string;
  graph: string;
  filterParams?: unknown;
  dashboardId?: string;
  gridColumn?: number;
  gridRow?: number;
  colSpan?: number;
  rowSpan?: number;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:122

// graphs.getAll
// Input: graphApiListInputSchema, ../contract/src/graph.trpc.ts:57
interface Input {
  projectId: string;
  dashboardId?: string;
}
// Output: graphListItemSchema.array() (inline, ../contract/src/graph.trpc.ts:191)

// graphs.delete
// Input: graphApiGraphInputSchema, ../contract/src/graph.trpc.ts:68
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:122

// graphs.getById
type Input = z.infer<typeof graphApiGraphInputSchema>; // ../contract/src/graph.trpc.ts:68
type Output = z.infer<typeof graphDetailSchema>; // ../contract/src/graph.trpc.ts:171

// graphs.updateById
// Input: graphApiUpdateInputSchema, ../contract/src/graph.trpc.ts:81
interface Input {
  projectId: string;
  name: string;
  graph: string;
  graphId: string;
  filterParams?: unknown;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:122

// graphs.updateLayout
// Input: graphApiUpdateLayoutInputSchema, ../contract/src/graph.trpc.ts:94
interface Input {
  projectId: string;
  graphId: string;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:122

// graphs.batchUpdateLayouts
// Input: graphApiBatchUpdateLayoutsInputSchema, ../contract/src/graph.trpc.ts:108
interface Input {
  projectId: string;
  layouts: {
    graphId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }[];
}
// Output: graphLayoutsUpdatedSchema, ../contract/src/graph.trpc.ts:178
interface Output {
  success: true;
}
```

### `savedViews`

Contract `../contract/src/saved-view.trpc.ts:48`, router `src/transport/saved-view.trpc.ts:10`.

| Procedure            | Kind     | Gate                     | Input                        | Output                           |
| -------------------- | -------- | ------------------------ | ---------------------------- | -------------------------------- |
| `savedViews.getAll`  | query    | Permission `traces:view` | `projectScopeSchema`         | inline                           |
| `savedViews.create`  | mutation | Permission `traces:view` | `savedViewCreateInputSchema` | `savedViewSchema`                |
| `savedViews.delete`  | mutation | Permission `traces:view` | `viewScopeSchema`            | `savedViewSchema`                |
| `savedViews.rename`  | mutation | Permission `traces:view` | inline                       | `savedViewSchema`                |
| `savedViews.reorder` | mutation | Permission `traces:view` | inline                       | `savedViewReorderResponseSchema` |

```typescript
// savedViews.getAll
// Input: projectScopeSchema, ../contract/src/saved-view.trpc.ts:17
interface Input {
  projectId: string;
  kind?: string;
}
// Output: savedViewSchema.array() (inline, ../contract/src/saved-view.trpc.ts:52)

// savedViews.create
type Input = z.infer<typeof savedViewCreateInputSchema>; // ../contract/src/saved-view.trpc.ts:46
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:59

// savedViews.delete
// Input: viewScopeSchema, ../contract/src/saved-view.trpc.ts:25
interface Input {
  projectId: string;
  viewId: string;
}
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:59

// savedViews.rename
// Input: inline, ../contract/src/saved-view.trpc.ts:67
interface Input {
  projectId: string;
  viewId: string;
  name: string;
}
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:59

// savedViews.reorder
// Input: inline, ../contract/src/saved-view.trpc.ts:71
interface Input {
  projectId: string;
  viewIds: string[];
}
// Output: savedViewReorderResponseSchema, ../contract/src/saved-view.ts:77
interface Output {
  success: true;
}
```

### `analytics.savedWorkbenchCharts`

Contract `../contract/src/saved-workbench-chart.trpc.ts:29`, router `src/transport/saved-workbench-chart.trpc.ts:12`.

| Procedure                                | Kind     | Gate                          | Input                | Output                             |
| ---------------------------------------- | -------- | ----------------------------- | -------------------- | ---------------------------------- |
| `analytics.savedWorkbenchCharts.getAll`  | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                             |
| `analytics.savedWorkbenchCharts.getById` | query    | Permission `analytics:view`   | `chartScopeSchema`   | `savedWorkbenchChartSchema`        |
| `analytics.savedWorkbenchCharts.create`  | mutation | Permission `analytics:create` | inline               | `savedWorkbenchChartSchema`        |
| `analytics.savedWorkbenchCharts.update`  | mutation | Permission `analytics:update` | inline               | `savedWorkbenchChartSchema`        |
| `analytics.savedWorkbenchCharts.run`     | mutation | Permission `analytics:view`   | inline               | `langWatchQLQueryResultSchema`     |
| `analytics.savedWorkbenchCharts.delete`  | mutation | Permission `analytics:delete` | `chartScopeSchema`   | `savedWorkbenchChartDeletedSchema` |

```typescript
// analytics.savedWorkbenchCharts.getAll
// Input: projectScopeSchema, ../contract/src/saved-workbench-chart.trpc.ts:16
interface Input {
  projectId: string;
}
// Output: savedWorkbenchChartSchema.array() (inline, ../contract/src/saved-workbench-chart.trpc.ts:32)

// analytics.savedWorkbenchCharts.getById
// Input: chartScopeSchema, ../contract/src/saved-workbench-chart.trpc.ts:17
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:115

// analytics.savedWorkbenchCharts.create
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:43
interface Input {
  projectId: string;
  name: string;
  definition: unknown;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:115

// analytics.savedWorkbenchCharts.update
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:53
interface Input {
  projectId: string;
  id: string;
  name?: string;
  definition?: unknown;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:115

// analytics.savedWorkbenchCharts.run
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:68
interface Input {
  projectId: string;
  id: string;
  timeWindow?: {
    start: string | number | unknown;
    end: string | number | unknown;
  };
  granularitySeconds?: 1 | 60 | 3600 | 86400 | 604800;
  onBudgetOverflow?: "refuse" | "coarsen";
}
type Output = z.infer<typeof langWatchQLQueryResultSchema>; // ../../analytics/contract/src/features/lwql/analytics.lwql.ts:111

// analytics.savedWorkbenchCharts.delete
type Input = z.infer<typeof chartScopeSchema>; // ../contract/src/saved-workbench-chart.trpc.ts:17
// Output: savedWorkbenchChartDeletedSchema, ../contract/src/saved-workbench-chart.trpc.ts:27
interface Output {
  success: true;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: dashboard declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                             |
| ------ | --------------- | -------------------- | --------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/dashboard.config.ts:5` |

<!-- readme:generated:end -->
