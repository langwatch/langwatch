# @langwatch/dashboard-process

The server half of [dashboard](../README.md). Dashboards and the graphs and saved workbench charts on them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("dashboard").withRepositories(dashboardRepositories).withApi(DashboardModule).withTransports(dashboardRest, dashboardWidgetRest, graphRest, savedWorkbenchChartRest, dashboardTrpcTransport, graphTrpcTransport, savedViewTrpcTransport, savedWorkbenchChartTrpcTransport, dashboardWidgetTrpcTransport).provideMiddlewareContext(…)`, `src/dashboard.module.ts:22`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DashboardApi`)

Flat operations a door or a peer calls once the dashboard app is composed.

Peers call these through the token, declared at `../contract/src/dashboard.api.ts:46`; nothing else in this package is public.

#### `getAll`

The project's boards the viewer may see, with their own `isStarred`; a project credential (no viewer) sees no Only me board. `includeOrganization` adds the Organization boards other projects of the organization own, each with its `ownerProject`.

```typescript
getAll(input: { projectId: string; graphCountScope: DashboardGraphCountScope; viewer?: DashboardViewer; includeOrganization?: boolean; }): Promise<DashboardSummary[]>;
```

#### `getById`

One board the viewer may open here: the project's own, or the organization's.

```typescript
getById(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard & { graphs: Graph[] }>;
```

#### `create`

`createdById` is the member creating it; absent for a project credential. Stars nothing.

```typescript
create(input: { projectId: string; name: string; createdById?: string }): Promise<Dashboard>;
```

#### `rename`

```typescript
rename(input: { projectId: string; dashboardId: string; name: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `delete`

Deletes the board and its graphs, and removes it from every member's stars.

```typescript
delete(input: { projectId: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<Dashboard>;
```

#### `reorder`

The legacy board `order`; written only by the REST reorder endpoint.

```typescript
reorder(input: { projectId: string; dashboardIds: string[]; viewer?: DashboardViewer; }): Promise<{ success: true }>;
```

#### `getOrCreateFirst`

The first dashboard, created on demand; empty on an aggregate that has none (ADR-177).

```typescript
getOrCreateFirst(input: { projectId: string; viewer?: DashboardViewer }): Promise<Dashboard[]>;
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

#### `updateDashboardDetails`

Dashboards area: `dashboards_not_enabled` while `release_dashboards` is off.

```typescript
updateDashboardDetails(input: { projectId: string; dashboardId: string; viewer: DashboardViewer; name?: string; description?: string | null; }): Promise<Dashboard>;
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

Every builder graph in the project, optionally only those on one board.

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

#### `assertCustomChartPlaygroundEnabled`

Custom chart widgets: a third kind of card on the same grid, whose definition analytics owns and whose placement this feature stores.

```typescript
assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void>;
```

#### `listDashboardWidgets`

The project's custom chart widgets, or one board's, the organization's boards included.

```typescript
listDashboardWidgets(input: { projectId: string; dashboardId?: string; viewer?: DashboardViewer; }): Promise<DashboardWidget[]>;
```

#### `getDashboardWidget`

```typescript
getDashboardWidget(input: { projectId: string; id: string; viewer?: DashboardViewer; }): Promise<DashboardWidget>;
```

#### `createDashboardWidget`

Placed on `dashboardId` when named, otherwise on the unplaced authoring grid.

```typescript
createDashboardWidget(input: { projectId: string; dashboardId?: string; name: string; viewer?: DashboardViewer; } & DashboardWidgetDefinitionInput): Promise<DashboardWidget>;
```

#### `updateDashboardWidget`

```typescript
updateDashboardWidget(input: { projectId: string; id: string; name?: string; viewer?: DashboardViewer; } & Partial<DashboardWidgetDefinitionInput>): Promise<DashboardWidget>;
```

#### `assignDashboardWidgetToDashboard`

```typescript
assignDashboardWidgetToDashboard(input: { projectId: string; id: string; dashboardId: string; viewer?: DashboardViewer; }): Promise<DashboardWidget>;
```

#### `deleteDashboardWidget`

```typescript
deleteDashboardWidget(input: { projectId: string; id: string; viewer?: DashboardViewer; }): Promise<void>;
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

### `dashboardWidgetRest`

|             |                                             |
| ----------- | ------------------------------------------- |
| Declared at | `src/transport/dashboard-widget.rest.ts:85` |
| Base URL    | none: each route's path is its address      |
| Addressing  | literal                                     |
| Credential  | project                                     |

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

List dashboard widgets

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:90`.

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

Permission `analytics:create`. Declared at `src/transport/dashboard-widget.rest.ts:116`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
type Params = z.infer<typeof dashboardWidgetProjectParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:103
type Body = z.infer<typeof createDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:30
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Get a dashboard widget

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:153`.

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

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:184`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:112
type Body = z.infer<typeof updateDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:50
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:87
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard`

Add a dashboard widget to a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:223`.

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

Permission `analytics:delete`. Declared at `src/transport/dashboard-widget.rest.ts:257`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:112
// Response: inline, src/transport/dashboard-widget.rest.ts:265
type Response = unknown;
```

### `dashboardRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/dashboard.rest.ts:22`         |
| Base URL    | `/api/dashboards`, twin `/api/v1/dashboards` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /` · `getApiDashboards`

List all dashboards for the project with graph counts

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:26`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-08-07`, `/api/v1/dashboards/2026-08-07`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
// Response: dashboardListResponseSchema, ../contract/src/dashboard.responses.ts:81
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

#### `POST /` · `postApiDashboards`

Create a new dashboard

Permission `analytics:create`. Declared at `src/transport/dashboard.rest.ts:59`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-08-07`, `/api/v1/dashboards/2026-08-07`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
// Body: dashboardRestNameSchema, ../contract/src/dashboard.ts:181
interface Body {
  name: string;
}
// Response: dashboardResponseSchema, ../contract/src/dashboard.responses.ts:84
interface Response {
  id: string;
  name: string;
  order: number;
  createdAt: unknown;
  updatedAt: unknown;
  platformUrl: string;
}
```

#### `PUT /reorder` · `putApiDashboardsReorder`

Reorder dashboards by providing an ordered list of IDs

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:79`.

Answers at `/api/dashboards/reorder`, `/api/v1/dashboards/reorder`; also, undocumented, `/api/dashboards/2026-08-07/reorder`, `/api/v1/dashboards/2026-08-07/reorder`, `/api/dashboards/latest/reorder`, `/api/v1/dashboards/latest/reorder`.

```typescript
// Body: dashboardRestReorderSchema, ../contract/src/dashboard.ts:190
interface Body {
  dashboardIds: string[];
}
// Response: dashboardReorderResponseSchema, ../contract/src/dashboard.responses.ts:113
interface Response {
  success: true;
}
```

#### `GET /:id` · `getApiDashboardsById`

Get a dashboard by its id, including its graphs

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:96`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
// Params: dashboardRestParamsSchema, ../contract/src/dashboard.ts:197
interface Params {
  id: string;
}
type Response = z.infer<typeof dashboardDetailResponseSchema>; // ../contract/src/dashboard.responses.ts:95
```

#### `PATCH /:id` · `patchApiDashboardsById`

Rename a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:114`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
type Params = z.infer<typeof dashboardRestParamsSchema>; // ../contract/src/dashboard.ts:197
type Body = z.infer<typeof dashboardRestNameSchema>; // ../contract/src/dashboard.ts:181
type Response = z.infer<typeof dashboardResponseSchema>; // ../contract/src/dashboard.responses.ts:84
```

#### `DELETE /:id` · `deleteApiDashboardsById`

Delete a dashboard and its graphs (hard delete, cascade)

Permission `analytics:manage`. Declared at `src/transport/dashboard.rest.ts:133`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
type Params = z.infer<typeof dashboardRestParamsSchema>; // ../contract/src/dashboard.ts:197
// Response: dashboardDeletedResponseSchema, ../contract/src/dashboard.responses.ts:106
interface Response {
  id: string;
  name: string;
}
```

### `graphRest`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/graph.rest.ts:35`     |
| Base URL    | `/api/graphs`, twin `/api/v1/graphs` |
| Addressing  | dated                                |
| Credential  | project                              |
| Versions    | `2026-08-07`                         |

#### `GET /` · `getApiGraphs`

List all custom graphs, optionally filtered by dashboard

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:39`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
// Query: graphRestListQuerySchema, ../contract/src/graph.ts:83
interface Query {
  dashboardId?: string;
}
type Response = z.infer<typeof graphListRestResponseSchema>; // ../contract/src/dashboard.responses.ts:140
```

#### `GET /:id` · `getApiGraphsById`

Get a custom graph by its ID

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:57`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
// Params: graphRestParamsSchema, ../contract/src/graph.ts:87
interface Params {
  id: string;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:133
```

#### `POST /` · `postApiGraphs`

Create a custom graph on a dashboard

Permission `analytics:create`. Declared at `src/transport/graph.rest.ts:69`.

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
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:133
```

#### `PATCH /:id` · `patchApiGraphsById`

Update a custom graph's name, definition, or filters

Permission `analytics:update`. Declared at `src/transport/graph.rest.ts:95`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:87
// Body: graphRestUpdateSchema, ../contract/src/graph.ts:108
interface Body {
  name?: string;
  graph?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:133
```

#### `DELETE /:id` · `deleteApiGraphsById`

Delete a custom graph

Permission `analytics:manage`. Declared at `src/transport/graph.rest.ts:119`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:87
// Response: graphDeletedResponseSchema, ../contract/src/dashboard.responses.ts:150
interface Response {
  id: string;
  deleted: boolean;
}
```

### `savedWorkbenchChartRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/saved-workbench-chart.rest.ts:103` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `GET /api/v1/projects/:projectId/analytics/charts` · `getApiV1ProjectsByProjectIdAnalyticsCharts`

List saved workbench charts

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:108`.

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

Permission `analytics:create`. Declared at `src/transport/saved-workbench-chart.rest.ts:134`.

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

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:171`.

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

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:205`.

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

Permission `analytics:delete`. Declared at `src/transport/saved-workbench-chart.rest.ts:244`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Response: inline, src/transport/saved-workbench-chart.rest.ts:252
type Response = unknown;
```

#### `PUT /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Place a saved workbench chart on a dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:274`.

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

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:312`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:126
// Response: inline, src/transport/saved-workbench-chart.rest.ts:320
type Response = unknown;
```

## tRPC transport

### `dashboardWidgets`

Contract `../contract/src/dashboard-widget.trpc.ts:84`, router `src/transport/dashboard-widget.trpc.ts:34`.

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
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:90
interface Input {
  projectId: string;
  dashboardId?: string;
}
// Output: dashboardWidgetTrpcRowSchema.array() (inline, ../contract/src/dashboard-widget.trpc.ts:91)

// dashboardWidgets.create
// Input: z.object({ ...projectScopeSchema.shape, dashboardId: z.string().optional(), name: dashboa… (inline, ../contract/src/dashboard-widget.trpc.ts:95)
type Output = z.infer<typeof dashboardWidgetTrpcSchema>; // ../contract/src/dashboard-widget.trpc.ts:57

// dashboardWidgets.update
// Input: z.object({ ...projectScopeSchema.shape, id: z.string(), name: dashboardWidgetNameSchema.o… (inline, ../contract/src/dashboard-widget.trpc.ts:110)
// Output: dashboardWidgetTrpcSuccessSchema, ../contract/src/dashboard-widget.trpc.ts:82
interface Output {
  success: true;
}

// dashboardWidgets.updateLayout
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:124
interface Input {
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  projectId: string;
  graphId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:82

// dashboardWidgets.batchUpdateLayouts
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:136
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
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:82

// dashboardWidgets.assignDashboard
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:144
interface Input {
  projectId: string;
  id: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:82

// dashboardWidgets.delete
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:148
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:82
```

### `dashboards`

Contract `../contract/src/dashboard.trpc.ts:32`, router `src/transport/dashboard.trpc.ts:10`.

| Procedure                      | Kind     | Gate                          | Input                | Output                           |
| ------------------------------ | -------- | ----------------------------- | -------------------- | -------------------------------- |
| `dashboards.getAll`            | query    | Permission `analytics:view`   | inline               | inline                           |
| `dashboards.getById`           | query    | Permission `analytics:view`   | `dashboardRefSchema` | `dashboardTrpcDetailSchema`      |
| `dashboards.create`            | mutation | Permission `analytics:create` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.rename`            | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.delete`            | mutation | Permission `analytics:delete` | `dashboardRefSchema` | `dashboardTrpcRowSchema`         |
| `dashboards.reorderDashboards` | mutation | Permission `analytics:update` | inline               | `dashboardReorderResponseSchema` |
| `dashboards.getOrCreateFirst`  | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                           |
| `dashboards.updateDetails`     | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.setScope`          | mutation | Permission `analytics:update` | inline               | `dashboardTrpcRowSchema`         |
| `dashboards.scopeImpact`       | query    | Permission `analytics:view`   | `dashboardRefSchema` | `dashboardScopeImpactSchema`     |
| `dashboards.scopeProjects`     | query    | Permission `analytics:view`   | `dashboardRefSchema` | `dashboardScopeProjectsSchema`   |
| `dashboards.listStarred`       | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                           |
| `dashboards.star`              | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |
| `dashboards.unstar`            | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |
| `dashboards.reorderStars`      | mutation | Permission `analytics:view`   | inline               | `dashboardReorderResponseSchema` |
| `dashboards.sourcePresence`    | query    | Permission `analytics:view`   | `projectScopeSchema` | `dashboardSourcePresenceSchema`  |

```typescript
// dashboards.getAll
// Input: inline, ../contract/src/dashboard.trpc.ts:40
interface Input {
  projectId: string;
  includeOrganization?: boolean;
}
// Output: dashboardTrpcSummarySchema.array() (inline, ../contract/src/dashboard.trpc.ts:46)

// dashboards.getById
// Input: dashboardRefSchema, ../contract/src/dashboard.trpc.ts:27
interface Input {
  projectId: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardTrpcDetailSchema>; // ../contract/src/dashboard.responses.ts:46

// dashboards.create
// Input: inline, ../contract/src/dashboard.trpc.ts:53
interface Input {
  projectId: string;
  name: string;
}
// Output: dashboardTrpcRowSchema, ../contract/src/dashboard.responses.ts:49
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

// dashboards.rename
// Input: inline, ../contract/src/dashboard.trpc.ts:57
interface Input {
  projectId: string;
  dashboardId: string;
  name: string;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:49

// dashboards.delete
type Input = z.infer<typeof dashboardRefSchema>; // ../contract/src/dashboard.trpc.ts:27
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:49

// dashboards.reorderDashboards
// Input: inline, ../contract/src/dashboard.trpc.ts:70
interface Input {
  projectId: string;
  dashboardIds: string[];
}
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:113

// dashboards.getOrCreateFirst
// Input: projectScopeSchema, ../contract/src/dashboard.trpc.ts:26
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/dashboard.trpc.ts:76
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

// dashboards.updateDetails
// Input: inline, ../contract/src/dashboard.trpc.ts:84
interface Input {
  projectId: string;
  dashboardId: string;
  name?: string;
  description?: string | null;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:49

// dashboards.setScope
// Input: inline, ../contract/src/dashboard.trpc.ts:94
interface Input {
  projectId: string;
  dashboardId: string;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:49

// dashboards.scopeImpact
type Input = z.infer<typeof dashboardRefSchema>; // ../contract/src/dashboard.trpc.ts:27
// Output: dashboardScopeImpactSchema, ../contract/src/dashboard.ts:100
interface Output {
  otherStars: number;
}

// dashboards.scopeProjects
type Input = z.infer<typeof dashboardRefSchema>; // ../contract/src/dashboard.trpc.ts:27
// Output: dashboardScopeProjectsSchema, ../contract/src/dashboard.ts:106
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

// dashboards.listStarred
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/dashboard.trpc.ts:26
// Output: starredDashboardSchema.array() (inline, ../contract/src/dashboard.trpc.ts:110)

// dashboards.star
// Input: inline, ../contract/src/dashboard.trpc.ts:114
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
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:113

// dashboards.unstar
// Input: inline, ../contract/src/dashboard.trpc.ts:118
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
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:113

// dashboards.reorderStars
// Input: z.object({ ...projectScopeSchema.shape, stars: z.array(dashboardStarSchema) }) (inline, ../contract/src/dashboard.trpc.ts:123)
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:113

// dashboards.sourcePresence
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/dashboard.trpc.ts:26
// Output: dashboardSourcePresenceSchema, ../contract/src/dashboard.ts:163
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
type Output = z.infer<typeof langWatchQLQueryResultSchema>; // ../../analytics/contract/src/features/lwql/analytics.lwql.ts:109

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
