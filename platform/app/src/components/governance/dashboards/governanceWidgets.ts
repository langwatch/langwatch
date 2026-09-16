/**
 * The four cost widgets the governance dashboards page draws, written as real
 * dashboard widgets rather than as bespoke React panels.
 *
 * Each one is a `DashboardWidgetDefinition` — the same shape `CustomGraph.graph`
 * persists and `DashboardWidgetFrame` renders — so what this page shows is the
 * product's own widget format, authored here instead of saved by a reader. A
 * definition that drifted out of that format would still draw on this page
 * while being impossible to save anywhere else, which is why
 * `__tests__/governanceWidgets.unit.test.ts` holds every one of them against
 * `dashboardWidgetDefinitionSchema` and against the grid's own placement unit.
 *
 * THE QUERIES ARE AUTHORED, NOT YET ANSWERABLE. They read
 * `governance_cost_rollup_1d` (migration 00092), which is not in the
 * LangWatchQL query catalog, so nothing executes them today: the page hands the
 * chart frame a sample answer factory (`sampleWidgetAnswers.ts`) whose columns
 * are checked against the aliases parsed out of this SQL. The statements still
 * say exactly what each chart asks for, so adding the dataset to the catalog is
 * what makes the page real — not a rewrite of these four questions.
 *
 * Two things the SQL names that do not exist yet, both deliberate:
 *
 *   - `{tenantId:String}`, bound the way every other ClickHouse read in the
 *     repository binds the tenant. It leads the predicate because no other
 *     identifier on this table is unique across tenants.
 *   - `governance_directory_people`, the read-time resolution of a provider's
 *     own actor identifier to a person and a department. The rollup stamps
 *     neither (migration 00092's header: they are resolved at read time so
 *     historical cost stays under the department it was spent by), and that
 *     resolution is not a dataset a query can join yet.
 *
 * Reads are replacement-aware (`argMax` over `EventTimestamp`, per ADR-015):
 * the fold writes one version per cycle and ReplacingMergeTree dedup is
 * eventual, so a plain `sum` over this table double-counts every row it has
 * written twice.
 *
 * @see specs/governance/governance-dashboards.feature
 */

import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
} from "~/server/analytics/dashboardWidgetDefinition";

/** One widget on the page: what it is called, what it asks, and where it sits. */
export interface GovernanceWidget {
  id: "provider_day" | "department" | "person" | "model_agent";
  name: string;
  definition: DashboardWidgetDefinition;
  placement: ChartGridPlacement;
}

export type GovernanceWidgetId = GovernanceWidget["id"];

/**
 * The tenant's own latest figure per rollup cell, over the page's window.
 *
 * Every widget starts from this: the dedup group is the table's full sort key,
 * so two spenders with identical numbers stay two rows, and `argMax` keeps only
 * the newest version of each. `AmountNanoUsd` is nullable on purpose — NULL
 * means no US-dollar figure is held, which is a different fact from zero spend
 * — so `tuple()` carries the null through `argMax` rather than collapsing it.
 */
const LATEST_CELLS_SQL = `  SELECT
    Day,
    Provider,
    Model,
    AgentId,
    RawActorId,
    argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd
  FROM governance_cost_rollup_1d
  WHERE TenantId = {tenantId:String}
    AND Day >= toDate({dashboard_context_period_start:DateTime})
    AND Day < toDate({dashboard_context_period_end:DateTime})
  GROUP BY
    TenantId,
    Day,
    CostSource,
    IngestionSourceId,
    Provider,
    Model,
    AgentId,
    CurrencyCode,
    RawActorId`;

/** Nano US dollars to dollars, at the precision money is read in. */
const COST_USD_SQL = "round(sum(cells.LatestAmountNanoUsd) / 1000000000, 2)";

/** The directory join both people charts resolve a raw actor through. */
const DIRECTORY_JOIN_SQL = `LEFT JOIN governance_directory_people AS directory
  ON directory.TenantId = {tenantId:String}
  AND directory.RawActorId = cells.RawActorId`;

/** Spend bucketed at the page's own granularity, split by who charged for it. */
const PROVIDER_DAY_SQL = `SELECT
  toStartOfInterval(cells.Day, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket,
  cells.Provider AS provider,
  ${COST_USD_SQL} AS cost_usd
FROM (
${LATEST_CELLS_SQL}
) AS cells
GROUP BY bucket, provider
ORDER BY bucket, provider`;

/**
 * Spend by the department the spender belonged to. Unresolved actors are named
 * rather than dropped: money nobody has claimed is still money that was spent,
 * and a chart that omits it reports a smaller bill than the provider sent.
 */
const DEPARTMENT_SQL = `SELECT
  coalesce(directory.DepartmentName, 'Unallocated') AS department,
  ${COST_USD_SQL} AS cost_usd
FROM (
${LATEST_CELLS_SQL}
) AS cells
${DIRECTORY_JOIN_SQL}
GROUP BY department
ORDER BY cost_usd DESC
LIMIT 20`;

/** Spend by the person who ran it, biggest spender first. */
const PERSON_SQL = `SELECT
  coalesce(directory.PersonName, cells.RawActorId) AS person,
  ${COST_USD_SQL} AS cost_usd
FROM (
${LATEST_CELLS_SQL}
) AS cells
${DIRECTORY_JOIN_SQL}
GROUP BY person
ORDER BY cost_usd DESC
LIMIT 20`;

/**
 * Spend by agent, split by the model it called. Cells the provider named no
 * agent for are kept under a name of their own, for the same reason the
 * department chart keeps unresolved actors.
 */
const MODEL_AGENT_SQL = `SELECT
  cells.Model AS model,
  if(cells.AgentId = '', 'Unattributed', cells.AgentId) AS agent,
  ${COST_USD_SQL} AS cost_usd
FROM (
${LATEST_CELLS_SQL}
) AS cells
GROUP BY model, agent
ORDER BY cost_usd DESC
LIMIT 40`;

/**
 * The stacked time series: one bar per bucket, one segment per provider.
 *
 * The answer arrives long — one row per (bucket, provider) — and Recharts
 * stacks wide, one `Bar` per series, so the rows are pivoted in the widget
 * rather than in SQL. The provider order is the order the answer names them
 * in, which the query already sorted, so the stack does not reshuffle between
 * renders.
 */
const PROVIDER_DAY_CODE = `import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#f97316", "#0ea5e9", "#22c55e", "#a855f7", "#ef4444", "#14b8a6"];

function Note({ text }) {
  return <div style={{ fontSize: "12px", color: "#666", padding: 8 }}>{text}</div>;
}

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("provider_day", {});

  const providers = [];
  const buckets = [];
  const byBucket = {};

  (data || []).forEach(function (row) {
    const bucket = String(row.bucket).slice(0, 10);
    const provider = String(row.provider);
    if (providers.indexOf(provider) === -1) providers.push(provider);
    if (!byBucket[bucket]) {
      byBucket[bucket] = { bucket: bucket };
      buckets.push(bucket);
    }
    byBucket[bucket][provider] = (byBucket[bucket][provider] || 0) + Number(row.cost_usd);
  });

  const rows = buckets.sort().map(function (bucket) { return byBucket[bucket]; });

  if (isError) return <Note text={error.message} />;
  if (isLoading) return <Note text="Loading..." />;
  if (rows.length === 0) return <Note text="No spend in this period" />;

  return (
    <div style={{ height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
          <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {providers.map(function (provider, index) {
            return <Bar key={provider} dataKey={provider} stackId="cost" fill={COLORS[index % COLORS.length]} />;
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
`;

/**
 * A ranked chart: one horizontal bar per group, longest first.
 *
 * Horizontal because the labels are names — a department or a person — and a
 * vertical axis gives a name room to be read without turning it on its side.
 */
const rankedChartCode = ({
  queryName,
  labelColumn,
  emptyText,
}: {
  queryName: GovernanceWidgetId;
  labelColumn: string;
  emptyText: string;
}): string => `import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function Note({ text }) {
  return <div style={{ fontSize: "12px", color: "#666", padding: 8 }}>{text}</div>;
}

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("${queryName}", {});

  const rows = (data || []).map(function (row) {
    return { label: String(row.${labelColumn}), cost_usd: Number(row.cost_usd) };
  });

  if (isError) return <Note text={error.message} />;
  if (isLoading) return <Note text="Loading..." />;
  if (rows.length === 0) return <Note text="${emptyText}" />;

  return (
    <div style={{ height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={132} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="cost_usd" fill="#f97316" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
`;

/**
 * Agents along the axis, one bar per model beside each.
 *
 * Grouped rather than stacked: the question this chart answers is which model
 * an agent's spend went to, and a stack hides the comparison it is asked for.
 */
const MODEL_AGENT_CODE = `import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#f97316", "#0ea5e9", "#22c55e", "#a855f7", "#ef4444", "#14b8a6"];

function Note({ text }) {
  return <div style={{ fontSize: "12px", color: "#666", padding: 8 }}>{text}</div>;
}

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("model_agent", {});

  const models = [];
  const agents = [];
  const byAgent = {};

  (data || []).forEach(function (row) {
    const agent = String(row.agent);
    const model = String(row.model);
    if (models.indexOf(model) === -1) models.push(model);
    if (!byAgent[agent]) {
      byAgent[agent] = { agent: agent };
      agents.push(agent);
    }
    byAgent[agent][model] = (byAgent[agent][model] || 0) + Number(row.cost_usd);
  });

  const rows = agents.map(function (agent) { return byAgent[agent]; });

  if (isError) return <Note text={error.message} />;
  if (isLoading) return <Note text="Loading..." />;
  if (rows.length === 0) return <Note text="No agent spend in this period" />;

  return (
    <div style={{ height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="agent" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
          <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {models.map(function (model, index) {
            return <Bar key={model} dataKey={model} fill={COLORS[index % COLORS.length]} />;
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
`;

/** One widget's definition: its file and the single query that file reads. */
const definition = ({
  id,
  sql,
  code,
}: {
  id: GovernanceWidgetId;
  sql: string;
  code: string;
}): DashboardWidgetDefinition => ({
  version: DASHBOARD_WIDGET_DEFINITION_VERSION,
  code,
  // No declared parameters: the window and the bucket size are the dashboard
  // context, which the executor binds regardless of what a query declares. A
  // required parameter here would be one this page has no way to supply.
  queries: [{ name: id, sql }],
});

/**
 * The four widgets, in the order the grid lays them out: the time series across
 * the top, the two ranked charts side by side under it, and the agent breakdown
 * across the bottom. `gridColumn` is zero-based, so a full-width card is
 * `0 + 8 <= 8`.
 */
export const GOVERNANCE_WIDGETS: readonly GovernanceWidget[] = [
  {
    id: "provider_day",
    name: "Spend over time by provider",
    definition: definition({
      id: "provider_day",
      sql: PROVIDER_DAY_SQL,
      code: PROVIDER_DAY_CODE,
    }),
    placement: {
      graphId: "provider_day",
      gridColumn: 0,
      gridRow: 0,
      colSpan: 8,
      rowSpan: 2,
    },
  },
  {
    id: "department",
    name: "Cost by department",
    definition: definition({
      id: "department",
      sql: DEPARTMENT_SQL,
      code: rankedChartCode({
        queryName: "department",
        labelColumn: "department",
        emptyText: "No department spend in this period",
      }),
    }),
    placement: {
      graphId: "department",
      gridColumn: 0,
      gridRow: 2,
      colSpan: 4,
      rowSpan: 2,
    },
  },
  {
    id: "person",
    name: "Cost by person",
    definition: definition({
      id: "person",
      sql: PERSON_SQL,
      code: rankedChartCode({
        queryName: "person",
        labelColumn: "person",
        emptyText: "No personal spend in this period",
      }),
    }),
    placement: {
      graphId: "person",
      gridColumn: 4,
      gridRow: 2,
      colSpan: 4,
      rowSpan: 2,
    },
  },
  {
    id: "model_agent",
    name: "Cost by model and agent",
    definition: definition({
      id: "model_agent",
      sql: MODEL_AGENT_SQL,
      code: MODEL_AGENT_CODE,
    }),
    placement: {
      graphId: "model_agent",
      gridColumn: 0,
      gridRow: 4,
      colSpan: 8,
      rowSpan: 2,
    },
  },
];
