import type { TableDefinition, TableDescription } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import {
  type MigrationTableShape,
  readMigrationSchema,
} from "~/server/clickhouse/migrationDdl";
import { TABLE_TTL_CONFIG } from "~/server/clickhouse/ttlReconciler";
import { billableEventsTable } from "../billing-reporting/table";
import {
  codingAgentSessionsTable,
  codingAgentTraceSessionsTable,
  sessionMetricSeriesTable,
} from "../coding-agent-processing/table";
import { evaluationAnalyticsTable } from "../evaluation-processing/table";
import {
  experimentRunItemsTable,
  experimentRunsTable,
} from "../experiment-run-processing/table";
import { langyAnalyticsEventsTable } from "../langy-conversation-processing/table";
import {
  logRecordsTable,
  logUsageEstimatesTable,
} from "../log-processing/table";
import {
  metricDataPointsTable,
  metricSeriesTable,
  metricTimeRollupsTable,
} from "../metric-processing/table";
import {
  simulationRunMessagesTable,
  simulationRunsTable,
} from "../simulation-processing/table";
import {
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "../topic-clustering-processing/tables";
import {
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
} from "../trace-processing/table";

/** Every table the pipeline tree declares, whatever its columns. */
const DECLARED: readonly TableDefinition<any>[] = [
  billableEventsTable,
  codingAgentSessionsTable,
  codingAgentTraceSessionsTable,
  sessionMetricSeriesTable,
  evaluationAnalyticsTable,
  experimentRunsTable,
  experimentRunItemsTable,
  langyAnalyticsEventsTable,
  logRecordsTable,
  logUsageEstimatesTable,
  metricDataPointsTable,
  metricSeriesTable,
  metricTimeRollupsTable,
  simulationRunsTable,
  simulationRunMessagesTable,
  topicClusteringRunStatusTable,
  topicClusteringRunHistoryTable,
  topicModelTable,
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
];

const deployed = readMigrationSchema();

/**
 * Tables whose declaration describes something the migrations do not contain,
 * each with the migration it is waiting on. A named list with a stated reason,
 * the way `structuralDebt` names a deployed constraint — not an allowlist:
 * a table that grows a new disagreement still fails, and an entry whose
 * disagreement is gone fails as stale.
 */
const UNSHIPPED = new Map<string, string>([
  [
    "stored_spans",
    "the declaration is the canonical span row; the deployed stored_spans is the legacy one of 00002, which span-storage.clickhouse.repository.ts still reads. Needs a new table and a cutover",
  ],
  [
    "simulation_run_messages",
    "messages live in the Messages.* nested arrays on simulation_runs today; creating this table without moving simulation.clickhouse.repository.ts's reads would strand them",
  ],
  [
    "topic_clustering_run_status",
    "the deployed read model is Postgres (topic.prisma.repository.ts)",
  ],
  [
    "topic_clustering_run_history",
    "the deployed read model is Postgres (topic.prisma.repository.ts)",
  ],
  [
    "topic_clustering_topic_model",
    "the deployed read model is the Postgres Topic table, which the settings UI and every Prisma join read",
  ],
]);

/**
 * Disagreements a code-only change cannot close, per table, verbatim as
 * {@link issuesFor} words them. Each needs a migration or a coordinated change
 * in a projection that fills the column, so each is listed rather than
 * silently tolerated — and the list is compared exactly, so a new
 * disagreement fails and a fixed one fails as stale.
 */
const PENDING: Map<string, readonly string[]> = new Map([
  [
    // `defineTable` has no way to name a sort-key entry that is not an
    // insertable column, and the deployed key sorts on a MATERIALIZED hash.
    "billable_events",
    [
      "declares sort key (OrganizationId, TenantId, DeduplicationKey) but the deployed ORDER BY is (OrganizationId, TenantId, DeduplicationKeyHash)",
    ],
  ],
]);

/**
 * The column a table's rows actually expire on. Most tables carry a `TTL` in
 * their DDL; the ones the reconciler manages carry none, and the reconciler's
 * own config is then the deployed truth.
 */
function retentionAnchorOf(shape: MigrationTableShape): string | null {
  if (shape.ttlExpression !== null) return shape.ttlExpression;
  const managed = TABLE_TTL_CONFIG.find((entry) => entry.table === shape.table);
  return managed ? (managed.retentionTTLColumn ?? managed.ttlColumn) : null;
}

/**
 * Whether the deployed DDL gives this column one of the roles a structural
 * debt is allowed to excuse — a pre-staged exemption is itself drift.
 */
function constrainsRow(shape: MigrationTableShape, column: string): boolean {
  return (
    shape.partitionExpression?.includes(column) === true ||
    shape.versionColumn === column ||
    retentionAnchorOf(shape)?.includes(column) === true ||
    shape.sortKey.includes(column)
  );
}

/** The engine's own contract: which column, if any, elects a version. */
function engineIssues(
  declaration: TableDescription,
  shape: MigrationTableShape,
): string[] {
  const { merge } = declaration;
  if (merge.kind === "replacing" && merge.version !== shape.versionColumn) {
    return [
      `declares replacing(version="${merge.version}") but the deployed engine versions on "${shape.versionColumn}"`,
    ];
  }
  if (
    merge.kind === "append" &&
    shape.versionColumn === null &&
    shape.partitionExpression === null
  ) {
    return ["declares append() but the deployed engine is not a MergeTree"];
  }
  return [];
}

/** `ORDER BY` and `PARTITION BY`: neither is alterable, so both must match. */
function keyIssues(
  declaration: TableDescription,
  shape: MigrationTableShape,
): string[] {
  const issues: string[] = [];
  if (declaration.sortKey.join(", ") !== shape.sortKey.join(", ")) {
    issues.push(
      `declares sort key (${declaration.sortKey.join(", ")}) but the deployed ORDER BY is (${shape.sortKey.join(", ")})`,
    );
  }
  if (declaration.partition.by !== shape.partitionExpression) {
    issues.push(
      `declares partition "${declaration.partition.by}" but the deployed PARTITION BY is "${shape.partitionExpression}"`,
    );
  }
  return issues;
}

function retentionIssues(
  declaration: TableDescription,
  shape: MigrationTableShape,
): string[] {
  if (!declaration.ttl) return [];
  const { anchor } = declaration.ttl;
  const retention = retentionAnchorOf(shape);
  if (retention === null) {
    return [
      `declares a TTL anchored on "${anchor}" but nothing expires the deployed table`,
    ];
  }
  if (!new RegExp(`\\b${anchor}\\b`).test(retention)) {
    return [
      `declares a TTL anchored on "${anchor}", which is not what expires the deployed table ("${retention}")`,
    ];
  }
  return [];
}

/** A declared column that is absent throws every insert; a wrong type decodes
 *  wrong or throws, so both are drift. */
function columnIssues(
  declaration: TableDescription,
  shape: MigrationTableShape,
): string[] {
  return declaration.columnNames.flatMap((column) => {
    const deployedType = shape.columnTypes.get(column);
    if (deployedType === undefined) {
      return [`declares column "${column}", which no migration adds`];
    }
    const declaredType = declaration.columnTypes[column]!;
    return deployedType === declaredType
      ? []
      : [
          `declares column "${column}" as "${declaredType}" but the deployed type is "${deployedType}"`,
        ];
  });
}

/** Every disagreement between one declaration and the DDL that deployed it. */
function issuesFor(
  table: TableDefinition<any>,
  shape: MigrationTableShape,
): string[] {
  const declaration = table.describe();
  return [
    ...engineIssues(declaration, shape),
    ...keyIssues(declaration, shape),
    ...retentionIssues(declaration, shape),
    ...columnIssues(declaration, shape),
  ];
}

describe("every ClickHouse table the pipelines declare", () => {
  for (const table of DECLARED) {
    const unshipped = UNSHIPPED.get(table.name);

    describe(`given ${table.name}`, () => {
      if (unshipped) {
        it(`is not deployed — ${unshipped}`, () => {
          const shape = deployed.get(table.name);
          expect(
            shape === undefined || issuesFor(table, shape).length > 0,
          ).toBe(true);
        });
        return;
      }

      it("is created by a migration", () => {
        expect(deployed.has(table.name)).toBe(true);
      });

      it("agrees with the deployed DDL on engine, keys, anchors and columns", () => {
        const shape = deployed.get(table.name);
        expect(shape, `${table.name} has no deployed DDL`).toBeDefined();
        expect(issuesFor(table, shape!)).toEqual(PENDING.get(table.name) ?? []);
      });
    });
  }

  it("names every structural debt on a column the migrations really constrain", () => {
    const misplaced = DECLARED.flatMap((table) => {
      const shape = deployed.get(table.name);
      if (!shape || UNSHIPPED.has(table.name)) return [];
      return (table.structuralDebt ?? [])
        .filter((debt) => !constrainsRow(shape, debt.column))
        .map(
          (debt) =>
            `${table.name}: "${debt.column}" carries a structural debt but the deployed DDL does not key, partition or expire on it`,
        );
    });
    expect(misplaced).toEqual([]);
  });
});
