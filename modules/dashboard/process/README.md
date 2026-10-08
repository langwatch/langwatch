# @langwatch/dashboard-process

The server half of [dashboard](../README.md). Dashboards and the graphs and saved workbench charts on them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("dashboard").withRepositories(dashboardRepositories).withApi(DashboardModule).withTransports(dashboardRest, dashboardWidgetRest, graphRest, savedWorkbenchChartRest, dashboardTrpcTransport, graphTrpcTransport, savedViewTrpcTransport, savedWorkbenchChartTrpcTransport, dashboardWidgetTrpcTransport).withTransportFacts(…)`, `src/dashboard.module.ts:24`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DashboardApi`)

Flat operations a door or a peer calls once the dashboard app is composed.

Peers call these through the token, declared at `../contract/src/dashboard.api.ts:36`; nothing else in this package is public.

#### `getAll`

```typescript
getAll(input: { projectId: string; graphCountScope: DashboardGraphCountScope; }): Promise<DashboardSummary[]>;
```

#### `getById`

```typescript
getById(input: { projectId: string; dashboardId: string; }): Promise<Dashboard & { graphs: Graph[] }>;
```

#### `create`

```typescript
create(input: { projectId: string; name: string }): Promise<Dashboard>;
```

#### `rename`

```typescript
rename(input: { projectId: string; dashboardId: string; name: string }): Promise<Dashboard>;
```

#### `delete`

```typescript
delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard>;
```

#### `reorder`

```typescript
reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }>;
```

#### `getOrCreateFirst`

```typescript
getOrCreateFirst(input: { projectId: string }): Promise<Dashboard>;
```

#### `getDashboardLinks`

Where a reader opens each of these dashboards, keyed by dashboard id.

```typescript
getDashboardLinks(input: { projectId: string; dashboardIds: string[]; }): Promise<Record<string, string>>;
```

#### `listGraphs`

```typescript
listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]>;
```

#### `getGraph`

```typescript
getGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
```

#### `createGraph`

```typescript
createGraph(input: { projectId: string; name: string; graph: Record<string, unknown>; filters?: Record<string, unknown>; dashboardId?: string; layout?: Partial<GraphLayout>; }): Promise<Graph>;
```

#### `updateGraph`

```typescript
updateGraph(input: { projectId: string; graphId: string; name?: string; graph?: Record<string, unknown>; filters?: Record<string, unknown>; }): Promise<Graph>;
```

#### `deleteGraph`

```typescript
deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
```

#### `updateGraphLayout`

```typescript
updateGraphLayout(input: { projectId: string; graphId: string; layout: GraphLayout; }): Promise<Graph>;
```

#### `batchUpdateGraphLayouts`

```typescript
batchUpdateGraphLayouts(input: { projectId: string; layouts: { graphId: string; layout: GraphLayout }[]; }): Promise<{ success: true }>;
```

#### `assertCustomChartPlaygroundEnabled`

Custom chart widgets: a third kind of card on the same grid, whose definition analytics owns and whose placement this feature stores.

```typescript
assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void>;
```

#### `listDashboardWidgets`

```typescript
listDashboardWidgets(input: { projectId: string }): Promise<DashboardWidget[]>;
```

#### `getDashboardWidget`

```typescript
getDashboardWidget(input: { projectId: string; id: string }): Promise<DashboardWidget>;
```

#### `createDashboardWidget`

Placed on `dashboardId` when named, otherwise on the unplaced authoring grid.

```typescript
createDashboardWidget(input: { projectId: string; dashboardId?: string; name: string; } & DashboardWidgetDefinitionInput): Promise<DashboardWidget>;
```

#### `updateDashboardWidget`

```typescript
updateDashboardWidget(input: { projectId: string; id: string; name?: string; } & Partial<DashboardWidgetDefinitionInput>): Promise<DashboardWidget>;
```

#### `assignDashboardWidgetToDashboard`

```typescript
assignDashboardWidgetToDashboard(input: { projectId: string; id: string; dashboardId: string; }): Promise<DashboardWidget>;
```

#### `deleteDashboardWidget`

```typescript
deleteDashboardWidget(input: { projectId: string; id: string }): Promise<void>;
```

#### `updateDashboardWidgetLayout`

Moves or resizes one widget; an id naming no widget here changes nothing.

```typescript
updateDashboardWidgetLayout(input: { projectId: string; graphId: string; layout: GraphLayout; }): Promise<{ success: true }>;
```

#### `batchUpdateDashboardWidgetLayouts`

Moves or resizes several widgets together; ids naming no widget here change nothing.

```typescript
batchUpdateDashboardWidgetLayouts(input: { projectId: string; layouts: { graphId: string; layout: GraphLayout }[]; }): Promise<{ success: true }>;
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

```typescript
listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]>;
```

#### `getSavedWorkbenchChart`

```typescript
getSavedWorkbenchChart(input: { projectId: string; chartId: string; }): Promise<SavedWorkbenchChart>;
```

#### `createSavedWorkbenchChart`

For a credential that resolved its own protections, such as an API key.

```typescript
createSavedWorkbenchChart(input: { projectId: string; protections: LangWatchQLProtections; name: string; definition: unknown; id?: string; }): Promise<SavedWorkbenchChart>;
```

#### `updateSavedWorkbenchChart`

```typescript
updateSavedWorkbenchChart(input: { projectId: string; chartId: string; name?: string; definitionUpdate?: SavedWorkbenchChartDefinitionUpdate; }): Promise<SavedWorkbenchChart>;
```

#### `createMemberSavedWorkbenchChart`

For a signed-in member, whose own protections decide what the chart may name.

```typescript
createMemberSavedWorkbenchChart(input: { projectId: string; actorId: string; name: string; definition: unknown; }): Promise<SavedWorkbenchChart>;
```

#### `updateMemberSavedWorkbenchChart`

```typescript
updateMemberSavedWorkbenchChart(input: { projectId: string; actorId: string; chartId: string; name?: string; definition?: unknown; }): Promise<SavedWorkbenchChart>;
```

#### `deleteSavedWorkbenchChart`

```typescript
deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
```

#### `placeSavedWorkbenchChart`

```typescript
placeSavedWorkbenchChart(input: { projectId: string; chartId: string; dashboardId: string; gridColumn?: number; gridRow?: number; colSpan?: number; rowSpan?: number; }): Promise<SavedWorkbenchChart>;
```

#### `unplaceSavedWorkbenchChart`

```typescript
unplaceSavedWorkbenchChart(input: { projectId: string; chartId: string; }): Promise<SavedWorkbenchChart>;
```

#### `runSavedWorkbenchChart`

```typescript
runSavedWorkbenchChart(input: { projectId: string; chartId: string; actorId: string; timeWindow?: LangWatchQLTimeWindow; granularitySeconds?: number; onBudgetOverflow?: LangWatchQLBudgetOverflowMode; }): Promise<LangWatchQLQueryResult>;
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
// Params: dashboardWidgetProjectParamsSchema, ../contract/src/dashboard-widget-rest.schemas.ts:89
interface Params {
  projectId: string;
}
type Response = z.infer<typeof dashboardWidgetListSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:85
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

Create a dashboard widget

Permission `analytics:create`. Declared at `src/transport/dashboard-widget.rest.ts:116`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
type Params = z.infer<typeof dashboardWidgetProjectParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:89
type Body = z.infer<typeof createDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:37
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Get a dashboard widget

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:149`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
// Params: dashboardWidgetParamsSchema, ../contract/src/dashboard-widget-rest.schemas.ts:90
interface Params {
  projectId: string;
  widgetId: string;
}
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `PATCH /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `patchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Update a dashboard widget

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:176`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
type Body = z.infer<typeof updateDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:43
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard`

Add a dashboard widget to a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:211`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
// Body: assignDashboardWidgetToDashboardSchema, ../contract/src/dashboard-widget-rest.schemas.ts:62
interface Body {
  dashboardId: string;
}
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `DELETE /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `deleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Delete a dashboard widget

Permission `analytics:delete`. Declared at `src/transport/dashboard-widget.rest.ts:243`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
// Response: inline, src/transport/dashboard-widget.rest.ts:250
type Response = unknown;
```

### `dashboardRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/dashboard.rest.ts:28`         |
| Base URL    | `/api/dashboards`, twin `/api/v1/dashboards` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /` · `getApiDashboards`

List all dashboards for the project with graph counts

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:32`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-08-07`, `/api/v1/dashboards/2026-08-07`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
// Response: dashboardListResponseSchema, ../contract/src/dashboard.responses.ts:50
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

Permission `analytics:create`. Declared at `src/transport/dashboard.rest.ts:61`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-08-07`, `/api/v1/dashboards/2026-08-07`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
// Body: dashboardRestNameSchema, ../contract/src/dashboard.ts:47
interface Body {
  name: string;
}
// Response: dashboardResponseSchema, ../contract/src/dashboard.responses.ts:55
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

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:75`.

Answers at `/api/dashboards/reorder`, `/api/v1/dashboards/reorder`; also, undocumented, `/api/dashboards/2026-08-07/reorder`, `/api/v1/dashboards/2026-08-07/reorder`, `/api/dashboards/latest/reorder`, `/api/v1/dashboards/latest/reorder`.

```typescript
// Body: dashboardRestReorderSchema, ../contract/src/dashboard.ts:51
interface Body {
  dashboardIds: string[];
}
// Response: dashboardReorderResponseSchema, ../contract/src/dashboard.responses.ts:69
interface Response {
  success: true;
}
```

#### `GET /:id` · `getApiDashboardsById`

Get a dashboard by its id, including its graphs

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:87`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
// Params: dashboardRestParamsSchema, ../contract/src/dashboard.ts:55
interface Params {
  id: string;
}
type Response = z.infer<typeof dashboardDetailResponseSchema>; // ../contract/src/dashboard.responses.ts:58
```

#### `PATCH /:id` · `patchApiDashboardsById`

Rename a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:101`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
type Params = z.infer<typeof dashboardRestParamsSchema>; // ../contract/src/dashboard.ts:55
type Body = z.infer<typeof dashboardRestNameSchema>; // ../contract/src/dashboard.ts:47
type Response = z.infer<typeof dashboardResponseSchema>; // ../contract/src/dashboard.responses.ts:55
```

#### `DELETE /:id` · `deleteApiDashboardsById`

Delete a dashboard and its graphs (hard delete, cascade)

Permission `analytics:manage`. Declared at `src/transport/dashboard.rest.ts:118`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
type Params = z.infer<typeof dashboardRestParamsSchema>; // ../contract/src/dashboard.ts:55
// Response: dashboardDeletedResponseSchema, ../contract/src/dashboard.responses.ts:64
interface Response {
  id: string;
  name: string;
}
```

### `graphRest`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/graph.rest.ts:41`     |
| Base URL    | `/api/graphs`, twin `/api/v1/graphs` |
| Addressing  | dated                                |
| Credential  | project                              |
| Versions    | `2026-08-07`                         |

#### `GET /` · `getApiGraphs`

List all custom graphs, optionally filtered by dashboard

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:45`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
// Query: graphRestListQuerySchema, ../contract/src/graph.ts:60
interface Query {
  dashboardId?: string;
}
type Response = z.infer<typeof graphListRestResponseSchema>; // ../contract/src/dashboard.responses.ts:89
```

#### `GET /:id` · `getApiGraphsById`

Get a custom graph by its ID

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:62`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
// Params: graphRestParamsSchema, ../contract/src/graph.ts:62
interface Params {
  id: string;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `POST /` · `postApiGraphs`

Create a custom graph on a dashboard

Permission `analytics:create`. Declared at `src/transport/graph.rest.ts:72`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
// Body: graphRestCreateSchema, ../contract/src/graph.ts:64
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
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `PATCH /:id` · `patchApiGraphsById`

Update a custom graph's name, definition, or filters

Permission `analytics:update`. Declared at `src/transport/graph.rest.ts:96`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:62
// Body: graphRestUpdateSchema, ../contract/src/graph.ts:75
interface Body {
  name?: string;
  graph?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `DELETE /:id` · `deleteApiGraphsById`

Delete a custom graph

Permission `analytics:manage`. Declared at `src/transport/graph.rest.ts:118`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:62
// Response: graphDeletedResponseSchema, ../contract/src/dashboard.responses.ts:91
interface Response {
  id: string;
  deleted: boolean;
}
```

### `savedWorkbenchChartRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/saved-workbench-chart.rest.ts:110` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `GET /api/v1/projects/:projectId/analytics/charts` · `getApiV1ProjectsByProjectIdAnalyticsCharts`

List saved workbench charts

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:115`.

Answers at `/api/v1/projects/:projectId/analytics/charts`.

```typescript
// Params: savedWorkbenchChartProjectParamsSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:83
interface Params {
  projectId: string;
}
type Response = z.infer<typeof savedWorkbenchChartListSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:79
```

#### `POST /api/v1/projects/:projectId/analytics/charts` · `postApiV1ProjectsByProjectIdAnalyticsCharts`

Save a workbench chart

Permission `analytics:create`. Declared at `src/transport/saved-workbench-chart.rest.ts:141`.

Answers at `/api/v1/projects/:projectId/analytics/charts`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartProjectParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:83
// Body: createSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:42
interface Body {
  name: string;
  definition?: unknown;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `GET /api/v1/projects/:projectId/analytics/charts/:chartId` · `getApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Get a saved workbench chart

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:177`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
// Params: savedWorkbenchChartParamsSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:87
interface Params {
  projectId: string;
  chartId: string;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `PATCH /api/v1/projects/:projectId/analytics/charts/:chartId` · `patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Update a saved workbench chart

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:207`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Body: updateSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:47
interface Body {
  name?: string;
  definition?: unknown;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Delete a saved workbench chart

Permission `analytics:delete`. Declared at `src/transport/saved-workbench-chart.rest.ts:244`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Response: inline, src/transport/saved-workbench-chart.rest.ts:251
type Response = unknown;
```

#### `PUT /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Place a saved workbench chart on a dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:269`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Body: placeSavedWorkbenchChartSchema, ../contract/src/saved-workbench-chart-rest.schemas.ts:33
interface Body {
  dashboardId: string;
  gridColumn?: number;
  gridRow?: number;
  colSpan?: number;
  rowSpan?: number;
}
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Remove a saved workbench chart from its dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:301`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Response: inline, src/transport/saved-workbench-chart.rest.ts:308
type Response = unknown;
```

## tRPC transport

### `dashboardWidgets`

Contract `../contract/src/dashboard-widget.trpc.ts:66`, router `src/transport/dashboard-widget.trpc.ts:33`.

| Procedure                             | Kind     | Gate                          | Input                | Output                             |
| ------------------------------------- | -------- | ----------------------------- | -------------------- | ---------------------------------- |
| `dashboardWidgets.list`               | query    | Permission `analytics:view`   | `projectScopeSchema` | inline                             |
| `dashboardWidgets.create`             | mutation | Permission `analytics:create` | inline               | `dashboardWidgetTrpcSchema`        |
| `dashboardWidgets.update`             | mutation | Permission `analytics:update` | inline               | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.updateLayout`       | mutation | Permission `analytics:update` | inline               | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.batchUpdateLayouts` | mutation | Permission `analytics:update` | inline               | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.assignDashboard`    | mutation | Permission `analytics:update` | inline               | `dashboardWidgetTrpcSuccessSchema` |
| `dashboardWidgets.delete`             | mutation | Permission `analytics:delete` | inline               | `dashboardWidgetTrpcSuccessSchema` |

```typescript
// dashboardWidgets.list
// Input: projectScopeSchema, ../contract/src/dashboard-widget.trpc.ts:20
interface Input {
  projectId: string;
}
// Output: dashboardWidgetTrpcRowSchema.array() (inline, ../contract/src/dashboard-widget.trpc.ts:69)

// dashboardWidgets.create
// Input: z.object({ ...projectScopeSchema.shape, dashboardId: z.string().optional(), name: dashboa… (inline, ../contract/src/dashboard-widget.trpc.ts:73)
type Output = z.infer<typeof dashboardWidgetTrpcSchema>; // ../contract/src/dashboard-widget.trpc.ts:41

// dashboardWidgets.update
// Input: z.object({ ...projectScopeSchema.shape, id: z.string(), name: dashboardWidgetNameSchema.o… (inline, ../contract/src/dashboard-widget.trpc.ts:85)
// Output: dashboardWidgetTrpcSuccessSchema, ../contract/src/dashboard-widget.trpc.ts:64
interface Output {
  success: true;
}

// dashboardWidgets.updateLayout
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:97
interface Input {
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  projectId: string;
  graphId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:64

// dashboardWidgets.batchUpdateLayouts
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:109
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
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:64

// dashboardWidgets.assignDashboard
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:117
interface Input {
  projectId: string;
  id: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:64

// dashboardWidgets.delete
// Input: inline, ../contract/src/dashboard-widget.trpc.ts:121
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof dashboardWidgetTrpcSuccessSchema>; // ../contract/src/dashboard-widget.trpc.ts:64
```

### `dashboards`

Contract `../contract/src/dashboard.trpc.ts:22`, router `src/transport/dashboard.trpc.ts:10`.

| Procedure                      | Kind     | Gate                          | Input                  | Output                           |
| ------------------------------ | -------- | ----------------------------- | ---------------------- | -------------------------------- |
| `dashboards.getAll`            | query    | Permission `analytics:view`   | `projectScopeSchema`   | inline                           |
| `dashboards.getById`           | query    | Permission `analytics:view`   | `dashboardScopeSchema` | `dashboardTrpcDetailSchema`      |
| `dashboards.create`            | mutation | Permission `analytics:create` | inline                 | `dashboardTrpcRowSchema`         |
| `dashboards.rename`            | mutation | Permission `analytics:update` | inline                 | `dashboardTrpcRowSchema`         |
| `dashboards.delete`            | mutation | Permission `analytics:delete` | `dashboardScopeSchema` | `dashboardTrpcRowSchema`         |
| `dashboards.reorderDashboards` | mutation | Permission `analytics:update` | inline                 | `dashboardReorderResponseSchema` |
| `dashboards.getOrCreateFirst`  | query    | Permission `analytics:view`   | `projectScopeSchema`   | `dashboardTrpcRowSchema`         |

```typescript
// dashboards.getAll
// Input: projectScopeSchema, ../contract/src/dashboard.trpc.ts:16
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/dashboard.trpc.ts:30
type Output = {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: unknown;
  updatedAt: unknown;
  _count: {
    graphs: number;
  };
}[];

// dashboards.getById
// Input: dashboardScopeSchema, ../contract/src/dashboard.trpc.ts:17
interface Input {
  projectId: string;
  dashboardId: string;
}
type Output = z.infer<typeof dashboardTrpcDetailSchema>; // ../contract/src/dashboard.responses.ts:25

// dashboards.create
// Input: inline, ../contract/src/dashboard.trpc.ts:37
interface Input {
  projectId: string;
  name: string;
}
// Output: dashboardTrpcRowSchema, ../contract/src/dashboard.responses.ts:30
interface Output {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: unknown;
  updatedAt: unknown;
}

// dashboards.rename
// Input: inline, ../contract/src/dashboard.trpc.ts:41
interface Input {
  projectId: string;
  dashboardId: string;
  name: string;
}
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:30

// dashboards.delete
type Input = z.infer<typeof dashboardScopeSchema>; // ../contract/src/dashboard.trpc.ts:17
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:30

// dashboards.reorderDashboards
// Input: inline, ../contract/src/dashboard.trpc.ts:50
interface Input {
  projectId: string;
  dashboardIds: string[];
}
type Output = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:69

// dashboards.getOrCreateFirst
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/dashboard.trpc.ts:16
type Output = z.infer<typeof dashboardTrpcRowSchema>; // ../contract/src/dashboard.responses.ts:30
```

### `graphs`

Contract `../contract/src/graph.trpc.ts:140`, router `src/transport/graph.trpc.ts:31`.

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
// Input: graphApiCreateInputSchema, ../contract/src/graph.trpc.ts:28
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
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:91

// graphs.getAll
// Input: graphApiListInputSchema, ../contract/src/graph.trpc.ts:47
interface Input {
  projectId: string;
  dashboardId?: string;
}
// Output: graphListItemSchema.array() (inline, ../contract/src/graph.trpc.ts:151)

// graphs.delete
// Input: graphApiGraphInputSchema, ../contract/src/graph.trpc.ts:53
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:91

// graphs.getById
type Input = z.infer<typeof graphApiGraphInputSchema>; // ../contract/src/graph.trpc.ts:53
type Output = z.infer<typeof graphDetailSchema>; // ../contract/src/graph.trpc.ts:130

// graphs.updateById
// Input: graphApiUpdateInputSchema, ../contract/src/graph.trpc.ts:58
interface Input {
  projectId: string;
  name: string;
  graph: string;
  graphId: string;
  filterParams?: unknown;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:91

// graphs.updateLayout
// Input: graphApiUpdateLayoutInputSchema, ../contract/src/graph.trpc.ts:66
interface Input {
  projectId: string;
  graphId: string;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}
type Output = z.infer<typeof legacyGraphSchema>; // ../contract/src/graph.trpc.ts:91

// graphs.batchUpdateLayouts
// Input: graphApiBatchUpdateLayoutsInputSchema, ../contract/src/graph.trpc.ts:74
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
// Output: graphLayoutsUpdatedSchema, ../contract/src/graph.trpc.ts:138
interface Output {
  success: true;
}
```

### `savedViews`

Contract `../contract/src/saved-view.trpc.ts:43`, router `src/transport/saved-view.trpc.ts:10`.

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
// Output: savedViewSchema.array() (inline, ../contract/src/saved-view.trpc.ts:47)

// savedViews.create
type Input = z.infer<typeof savedViewCreateInputSchema>; // ../contract/src/saved-view.trpc.ts:27
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:44

// savedViews.delete
// Input: viewScopeSchema, ../contract/src/saved-view.trpc.ts:25
interface Input {
  projectId: string;
  viewId: string;
}
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:44

// savedViews.rename
// Input: inline, ../contract/src/saved-view.trpc.ts:62
interface Input {
  projectId: string;
  viewId: string;
  name: string;
}
type Output = z.infer<typeof savedViewSchema>; // ../contract/src/saved-view.ts:44

// savedViews.reorder
// Input: inline, ../contract/src/saved-view.trpc.ts:66
interface Input {
  projectId: string;
  viewIds: string[];
}
// Output: savedViewReorderResponseSchema, ../contract/src/saved-view.ts:67
interface Output {
  success: true;
}
```

### `analytics.savedWorkbenchCharts`

Contract `../contract/src/saved-workbench-chart.trpc.ts:35`, router `src/transport/saved-workbench-chart.trpc.ts:12`.

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
// Output: savedWorkbenchChartSchema.array() (inline, ../contract/src/saved-workbench-chart.trpc.ts:38)

// analytics.savedWorkbenchCharts.getById
// Input: chartScopeSchema, ../contract/src/saved-workbench-chart.trpc.ts:17
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:85

// analytics.savedWorkbenchCharts.create
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:49
interface Input {
  projectId: string;
  name: string;
  definition: unknown;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:85

// analytics.savedWorkbenchCharts.update
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:59
interface Input {
  projectId: string;
  id: string;
  name?: string;
  definition?: unknown;
}
type Output = z.infer<typeof savedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart.ts:85

// analytics.savedWorkbenchCharts.run
// Input: inline, ../contract/src/saved-workbench-chart.trpc.ts:74
interface Input {
  projectId: string;
  id: string;
  timeWindow?: {
    start: string | number | unknown;
    end: string | number | unknown;
  };
  granularitySeconds?: 1 | 60 | 3600;
  onBudgetOverflow?: "refuse" | "coarsen";
}
type Output = z.infer<typeof langWatchQLQueryResultSchema>; // ../../analytics/contract/src/analytics.lwql.ts:55

// analytics.savedWorkbenchCharts.delete
type Input = z.infer<typeof chartScopeSchema>; // ../contract/src/saved-workbench-chart.trpc.ts:17
// Output: savedWorkbenchChartDeletedSchema, ../contract/src/saved-workbench-chart.trpc.ts:33
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
