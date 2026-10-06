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
| Declared at | `src/transport/dashboard-widget.rest.ts:78` |
| Base URL    | none: each route's path is its address      |
| Addressing  | literal                                     |
| Credential  | project                                     |

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

List dashboard widgets

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:83`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
type Params = z.infer<typeof dashboardWidgetProjectParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:89
type Response = z.infer<typeof dashboardWidgetListSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:85
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets`

Create a dashboard widget

Permission `analytics:create`. Declared at `src/transport/dashboard-widget.rest.ts:108`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets`.

```typescript
type Params = z.infer<typeof dashboardWidgetProjectParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:89
type Body = z.infer<typeof createDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:37
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `GET /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Get a dashboard widget

Permission `analytics:view`. Declared at `src/transport/dashboard-widget.rest.ts:140`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `PATCH /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `patchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Update a dashboard widget

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:166`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
type Body = z.infer<typeof updateDashboardWidgetSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:43
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `POST /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard` · `postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard`

Add a dashboard widget to a dashboard

Permission `analytics:update`. Declared at `src/transport/dashboard-widget.rest.ts:200`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
type Body = z.infer<typeof assignDashboardWidgetToDashboardSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:62
type Response = z.infer<typeof dashboardWidgetResourceSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:66
```

#### `DELETE /api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId` · `deleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId`

Delete a dashboard widget

Permission `analytics:delete`. Declared at `src/transport/dashboard-widget.rest.ts:231`.

Answers at `/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId`.

```typescript
type Params = z.infer<typeof dashboardWidgetParamsSchema>; // ../contract/src/dashboard-widget-rest.schemas.ts:90
// Response: z.void() (inline, src/transport/dashboard-widget.rest.ts:237)
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
type Response = z.infer<typeof dashboardListResponseSchema>; // ../contract/src/dashboard.responses.ts:50
```

#### `POST /` · `postApiDashboards`

Create a new dashboard

Permission `analytics:create`. Declared at `src/transport/dashboard.rest.ts:61`.

Answers at `/api/dashboards`, `/api/v1/dashboards`; also, undocumented, `/api/dashboards/2026-08-07`, `/api/v1/dashboards/2026-08-07`, `/api/dashboards/latest`, `/api/v1/dashboards/latest`.

```typescript
type Body = z.infer<typeof dashboardRestNameSchema>; // ../contract/src/dashboard.ts:47
type Response = z.infer<typeof dashboardResponseSchema>; // ../contract/src/dashboard.responses.ts:55
```

#### `PUT /reorder` · `putApiDashboardsReorder`

Reorder dashboards by providing an ordered list of IDs

Permission `analytics:update`. Declared at `src/transport/dashboard.rest.ts:75`.

Answers at `/api/dashboards/reorder`, `/api/v1/dashboards/reorder`; also, undocumented, `/api/dashboards/2026-08-07/reorder`, `/api/v1/dashboards/2026-08-07/reorder`, `/api/dashboards/latest/reorder`, `/api/v1/dashboards/latest/reorder`.

```typescript
type Body = z.infer<typeof dashboardRestReorderSchema>; // ../contract/src/dashboard.ts:51
type Response = z.infer<typeof dashboardReorderResponseSchema>; // ../contract/src/dashboard.responses.ts:69
```

#### `GET /:id` · `getApiDashboardsById`

Get a dashboard by its id, including its graphs

Permission `analytics:view`. Declared at `src/transport/dashboard.rest.ts:87`.

Answers at `/api/dashboards/:id`, `/api/v1/dashboards/:id`; also, undocumented, `/api/dashboards/2026-08-07/:id`, `/api/v1/dashboards/2026-08-07/:id`, `/api/dashboards/latest/:id`, `/api/v1/dashboards/latest/:id`.

```typescript
type Params = z.infer<typeof dashboardRestParamsSchema>; // ../contract/src/dashboard.ts:55
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
type Response = z.infer<typeof dashboardDeletedResponseSchema>; // ../contract/src/dashboard.responses.ts:64
```

### `graphRest`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/graph.rest.ts:40`     |
| Base URL    | `/api/graphs`, twin `/api/v1/graphs` |
| Addressing  | dated                                |
| Credential  | project                              |
| Versions    | `2026-08-07`                         |

#### `GET /` · `getApiGraphs`

List all custom graphs, optionally filtered by dashboard

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:44`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
type Query = z.infer<typeof graphRestListQuerySchema>; // ../contract/src/graph.ts:60
type Response = z.infer<typeof graphListRestResponseSchema>; // ../contract/src/dashboard.responses.ts:89
```

#### `GET /:id` · `getApiGraphsById`

Get a custom graph by its ID

Permission `analytics:view`. Declared at `src/transport/graph.rest.ts:61`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:62
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `POST /` · `postApiGraphs`

Create a custom graph on a dashboard

Permission `analytics:create`. Declared at `src/transport/graph.rest.ts:71`.

Answers at `/api/graphs`, `/api/v1/graphs`; also, undocumented, `/api/graphs/2026-08-07`, `/api/v1/graphs/2026-08-07`, `/api/graphs/latest`, `/api/v1/graphs/latest`.

```typescript
type Body = z.infer<typeof graphRestCreateSchema>; // ../contract/src/graph.ts:64
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `PATCH /:id` · `patchApiGraphsById`

Update a custom graph's name, definition, or filters

Permission `analytics:update`. Declared at `src/transport/graph.rest.ts:95`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:62
type Body = z.infer<typeof graphRestUpdateSchema>; // ../contract/src/graph.ts:75
type Response = z.infer<typeof graphRestResponseSchema>; // ../contract/src/dashboard.responses.ts:75
```

#### `DELETE /:id` · `deleteApiGraphsById`

Delete a custom graph

Permission `analytics:manage`. Declared at `src/transport/graph.rest.ts:117`.

Answers at `/api/graphs/:id`, `/api/v1/graphs/:id`; also, undocumented, `/api/graphs/2026-08-07/:id`, `/api/v1/graphs/2026-08-07/:id`, `/api/graphs/latest/:id`, `/api/v1/graphs/latest/:id`.

```typescript
type Params = z.infer<typeof graphRestParamsSchema>; // ../contract/src/graph.ts:62
type Response = z.infer<typeof graphDeletedResponseSchema>; // ../contract/src/dashboard.responses.ts:91
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
type Params = z.infer<typeof savedWorkbenchChartProjectParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:83
type Response = z.infer<typeof savedWorkbenchChartListSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:79
```

#### `POST /api/v1/projects/:projectId/analytics/charts` · `postApiV1ProjectsByProjectIdAnalyticsCharts`

Save a workbench chart

Permission `analytics:create`. Declared at `src/transport/saved-workbench-chart.rest.ts:133`.

Answers at `/api/v1/projects/:projectId/analytics/charts`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartProjectParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:83
type Body = z.infer<typeof createSavedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:42
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `GET /api/v1/projects/:projectId/analytics/charts/:chartId` · `getApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Get a saved workbench chart

Permission `analytics:view`. Declared at `src/transport/saved-workbench-chart.rest.ts:168`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `PATCH /api/v1/projects/:projectId/analytics/charts/:chartId` · `patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Update a saved workbench chart

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:197`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
type Body = z.infer<typeof updateSavedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:47
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartId`

Delete a saved workbench chart

Permission `analytics:delete`. Declared at `src/transport/saved-workbench-chart.rest.ts:233`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Response: z.void() (inline, src/transport/saved-workbench-chart.rest.ts:239)
```

#### `PUT /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Place a saved workbench chart on a dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:257`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
type Body = z.infer<typeof placeSavedWorkbenchChartSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:33
type Response = z.infer<typeof savedWorkbenchChartResourceSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:65
```

#### `DELETE /api/v1/projects/:projectId/analytics/charts/:chartId/placement` · `deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement`

Remove a saved workbench chart from its dashboard

Permission `analytics:update`. Declared at `src/transport/saved-workbench-chart.rest.ts:288`.

Answers at `/api/v1/projects/:projectId/analytics/charts/:chartId/placement`.

```typescript
type Params = z.infer<typeof savedWorkbenchChartParamsSchema>; // ../contract/src/saved-workbench-chart-rest.schemas.ts:87
// Response: z.void() (inline, src/transport/saved-workbench-chart.rest.ts:294)
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

### `graphs`

Contract `../contract/src/graph.trpc.ts:139`, router `src/transport/graph.trpc.ts:34`.

| Procedure                   | Kind     | Gate                          | Input                                   | Output                      |
| --------------------------- | -------- | ----------------------------- | --------------------------------------- | --------------------------- |
| `graphs.create`             | mutation | Permission `analytics:create` | `graphApiCreateInputSchema`             | `legacyGraphSchema`         |
| `graphs.getAll`             | query    | Permission `analytics:view`   | `graphApiListInputSchema`               | inline                      |
| `graphs.delete`             | mutation | Permission `analytics:delete` | `graphApiGraphInputSchema`              | `legacyGraphSchema`         |
| `graphs.getById`            | query    | Permission `analytics:view`   | `graphApiGraphInputSchema`              | `graphDetailSchema`         |
| `graphs.updateById`         | mutation | Permission `analytics:update` | `graphApiUpdateInputSchema`             | `legacyGraphSchema`         |
| `graphs.updateLayout`       | mutation | Permission `analytics:update` | `graphApiUpdateLayoutInputSchema`       | `legacyGraphSchema`         |
| `graphs.batchUpdateLayouts` | mutation | Permission `analytics:update` | `graphApiBatchUpdateLayoutsInputSchema` | `graphLayoutsUpdatedSchema` |

### `savedViews`

Contract `../contract/src/saved-view.trpc.ts:43`, router `src/transport/saved-view.trpc.ts:10`.

| Procedure            | Kind     | Gate                     | Input                        | Output                           |
| -------------------- | -------- | ------------------------ | ---------------------------- | -------------------------------- |
| `savedViews.getAll`  | query    | Permission `traces:view` | `projectScopeSchema`         | inline                           |
| `savedViews.create`  | mutation | Permission `traces:view` | `savedViewCreateInputSchema` | `savedViewSchema`                |
| `savedViews.delete`  | mutation | Permission `traces:view` | `viewScopeSchema`            | `savedViewSchema`                |
| `savedViews.rename`  | mutation | Permission `traces:view` | inline                       | `savedViewSchema`                |
| `savedViews.reorder` | mutation | Permission `traces:view` | inline                       | `savedViewReorderResponseSchema` |

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: dashboard declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                             |
| ------ | --------------- | -------------------- | --------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/dashboard.config.ts:5` |

<!-- readme:generated:end -->
