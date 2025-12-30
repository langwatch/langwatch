/**
 * GDPR Elasticsearch Project Data Deletion Task
 *
 * Deletes all Elasticsearch data for specified project IDs.
 * Standalone task for ES-only cleanup (not tied to user deletion).
 *
 * Usage:
 *   Dry run:  pnpm run task gdpr/deleteProjectEsData proj_123
 *   Execute:  pnpm run task gdpr/deleteProjectEsData proj_123 --execute
 *   Multiple: pnpm run task gdpr/deleteProjectEsData proj_123,proj_456 --execute
 */

import { PrismaClient } from "@prisma/client";
import {
  esClient,
  TRACE_INDEX,
  DSPY_STEPS_INDEX,
  BATCH_EVALUATION_INDEX,
  SCENARIO_EVENTS_INDEX,
} from "../../server/elasticsearch";

const prisma = new PrismaClient();

// ============================================================
// Types
// ============================================================

interface EsDeletionReport {
  projectIds: string[];
  mode: "dry-run" | "execute";
  timestamp: string;
  counts: {
    traces: number;
    dspySteps: number;
    batchEvaluations: number;
    scenarioEvents: number;
    total: number;
  };
}

// ============================================================
// Helpers
// ============================================================

const log = (message: string) => console.log(message);
const logSuccess = (message: string) => console.log(`✅ ${message}`);

// ============================================================
// Elasticsearch Operations
// ============================================================

/**
 * Validates all projects belong to the same organization.
 *
 * Organizations can have custom ES configs (elasticsearchNodeUrl/elasticsearchApiKey).
 * If projects span multiple orgs with different ES clusters, using a single client
 * would miss documents stored in other clusters. We validate same-org to prevent
 * silent data retention failures during GDPR deletion.
 */
async function validateSameOrganization(projectIds: string[]): Promise<void> {
  if (projectIds.length <= 1) return;

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, team: { select: { organizationId: true } } },
  });

  const orgIds = new Set(projects.map((p) => p.team.organizationId));

  if (orgIds.size > 1) {
    throw new Error(
      `Projects span ${orgIds.size} organizations. ` +
        `Organizations may have different ES clusters. ` +
        `Run deletion separately per organization to ensure complete data removal.`
    );
  }
}

export async function countEsDocuments(projectIds: string[]) {
  if (projectIds.length === 0) {
    return { traces: 0, dspySteps: 0, batchEvaluations: 0, scenarioEvents: 0 };
  }

  await validateSameOrganization(projectIds);
  const client = await esClient({ projectId: projectIds[0]! });
  const query = { terms: { project_id: projectIds } };

  const [traces, dspySteps, batchEvals, scenarios] = await Promise.all([
    client
      .count({ index: TRACE_INDEX.all, query })
      .then((r) => r.count)
      .catch(() => 0),
    client
      .count({ index: DSPY_STEPS_INDEX.alias, query })
      .then((r) => r.count)
      .catch(() => 0),
    client
      .count({ index: BATCH_EVALUATION_INDEX.alias, query })
      .then((r) => r.count)
      .catch(() => 0),
    client
      .count({ index: SCENARIO_EVENTS_INDEX.alias, query })
      .then((r) => r.count)
      .catch(() => 0),
  ]);

  return {
    traces,
    dspySteps,
    batchEvaluations: batchEvals,
    scenarioEvents: scenarios,
  };
}

export async function deleteEsDocuments(projectIds: string[]) {
  if (projectIds.length === 0) return { deleted: 0 };

  await validateSameOrganization(projectIds);
  const client = await esClient({ projectId: projectIds[0]! });
  const query = { terms: { project_id: projectIds } };

  const results = await Promise.all([
    client
      .deleteByQuery({
        index: TRACE_INDEX.all,
        body: { query },
        conflicts: "proceed",
      })
      .then((r) => ({ index: "traces", deleted: r.deleted ?? 0 })),
    client
      .deleteByQuery({
        index: DSPY_STEPS_INDEX.alias,
        body: { query },
        conflicts: "proceed",
      })
      .then((r) => ({ index: "dspy-steps", deleted: r.deleted ?? 0 })),
    client
      .deleteByQuery({
        index: BATCH_EVALUATION_INDEX.alias,
        body: { query },
        conflicts: "proceed",
      })
      .then((r) => ({ index: "batch-evaluations", deleted: r.deleted ?? 0 })),
    client
      .deleteByQuery({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: { query },
        conflicts: "proceed",
      })
      .then((r) => ({ index: "scenario-events", deleted: r.deleted ?? 0 })),
  ]);

  let totalDeleted = 0;
  for (const r of results) {
    log(`  Deleted ${r.deleted} documents from ${r.index}`);
    totalDeleted += r.deleted;
  }

  return { deleted: totalDeleted };
}

// ============================================================
// Main Execution
// ============================================================

function printReport(report: EsDeletionReport) {
  log("");
  log("═══════════════════════════════════════════════════════════════");
  log("           ELASTICSEARCH PROJECT DATA DELETION REPORT");
  log("═══════════════════════════════════════════════════════════════");
  log("");
  log(`Timestamp: ${report.timestamp}`);
  log(`Mode: ${report.mode === "execute" ? "🔴 EXECUTE" : "🟢 DRY RUN"}`);
  log("");

  log("📁 TARGET PROJECTS:");
  for (const projectId of report.projectIds) {
    log(`  - ${projectId}`);
  }
  log("");

  log("📊 DOCUMENT COUNTS:");
  log(`  Traces: ${report.counts.traces}`);
  log(`  DSPy Steps: ${report.counts.dspySteps}`);
  log(`  Batch Evaluations: ${report.counts.batchEvaluations}`);
  log(`  Scenario Events: ${report.counts.scenarioEvents}`);
  log(`  ─────────────────`);
  log(`  Total: ${report.counts.total}`);
  log("");

  log("═══════════════════════════════════════════════════════════════");
}

export async function deleteProjectEsData(
  projectIds: string[],
  options: { execute?: boolean } = {}
) {
  const executeMode = options.execute ?? false;

  log(`\n🔍 Analyzing ES data for ${projectIds.length} project(s)...`);

  const counts = await countEsDocuments(projectIds);
  const total = counts.traces + counts.dspySteps + counts.batchEvaluations + counts.scenarioEvents;

  const report: EsDeletionReport = {
    projectIds,
    mode: executeMode ? "execute" : "dry-run",
    timestamp: new Date().toISOString(),
    counts: { ...counts, total },
  };

  printReport(report);

  if (total === 0) {
    log("✅ No documents found for the specified project(s).");
    return report;
  }

  if (!executeMode) {
    log("🟢 DRY RUN COMPLETE - NO CHANGES MADE");
    log("");
    log("To execute deletion, run:");
    log(`  pnpm run task gdpr/deleteProjectEsData ${projectIds.join(",")} --execute`);
    return report;
  }

  // Execute deletion
  log("🔴 EXECUTING DELETION...");
  log("");

  const result = await deleteEsDocuments(projectIds);

  log("");
  logSuccess(`Deleted ${result.deleted} total documents`);

  // Verify
  log("");
  log("🔍 Verifying deletion...");
  const remaining = await countEsDocuments(projectIds);
  const remainingTotal =
    remaining.traces +
    remaining.dspySteps +
    remaining.batchEvaluations +
    remaining.scenarioEvents;

  if (remainingTotal === 0) {
    logSuccess("All documents successfully deleted");
  } else {
    log(`⚠️  ${remainingTotal} documents remain (may be due to replication lag)`);
  }

  log("");
  log("═══════════════════════════════════════════════════════════════");
  log("                    DELETION COMPLETE");
  log("═══════════════════════════════════════════════════════════════");

  return report;
}

export default async function execute(projectIdsArg?: string, ...args: string[]) {
  if (!projectIdsArg) {
    throw new Error(
      "Project ID(s) required. Usage: pnpm run task gdpr/deleteProjectEsData proj_123 [--execute]"
    );
  }

  const projectIds = projectIdsArg.split(",").map((id) => id.trim());
  const executeMode = args.includes("--execute");

  await deleteProjectEsData(projectIds, { execute: executeMode });
}

