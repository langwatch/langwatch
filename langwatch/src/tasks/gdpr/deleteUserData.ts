/**
 * GDPR User Data Deletion Task
 *
 * Deletes all data associated with a user for GDPR compliance.
 * - Postgres: User, sole-owned orgs/teams/projects and all children
 * - Elasticsearch: traces, dspy-steps, batch-evaluations, scenario-events
 *
 * Usage:
 *   Dry run:  pnpm run task gdpr/deleteUserData user@example.com
 *   Execute:  pnpm run task gdpr/deleteUserData user@example.com --execute
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { countEsDocuments, deleteEsDocuments } from "./deleteProjectEsData";

// ============================================================
// File Logging Setup
// ============================================================

const REPORTS_DIR = path.join(__dirname, "../../../reports");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// SQL log file stream
let sqlLogPath: string;
let sqlLogStream: fs.WriteStream;

function initSqlLog(email: string) {
  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, "_");
  sqlLogPath = path.join(REPORTS_DIR, `sql_${timestamp}_${safeEmail}.log`);
  sqlLogStream = fs.createWriteStream(sqlLogPath, { flags: "a" });
}

/**
 * Unprotected Prisma client for admin operations.
 *
 * The standard client has multi-tenancy guards that require projectId/organizationId
 * in queries. For GDPR deletion, we need to discover and traverse ALL of a user's
 * data across ALL tenants - inherently cross-tenant by design.
 */
const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

// Route query logs to file
prisma.$on("query" as never, (e: { query: string; params: string; duration: number }) => {
  if (sqlLogStream) {
    sqlLogStream.write(`[${new Date().toISOString()}] ${e.duration}ms\n`);
    sqlLogStream.write(`${e.query}\n`);
    sqlLogStream.write(`Params: ${e.params}\n\n`);
  }
});

function writeReportFile(email: string, lines: string[]) {
  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, "_");
  const reportPath = path.join(REPORTS_DIR, `user_deletion_${timestamp}_${safeEmail}.txt`);

  // Strip ANSI color codes for file output
  const cleanLines = lines.map(line =>
    line.replace(/\x1b\[[0-9;]*m/g, "")
  );

  fs.writeFileSync(reportPath, cleanLines.join("\n"));
  console.log(`\n📄 Report saved to: ${reportPath}`);
  console.log(`📄 SQL log saved to: ${sqlLogPath}`);

  // Close SQL log stream
  if (sqlLogStream) {
    sqlLogStream.end();
  }
}

// ============================================================
// Types
// ============================================================

interface DeletionReport {
  userId: string;
  email: string;
  mode: "dry-run" | "execute";
  timestamp: string;
  counts: {
    organizations: { total: number; soleOwned: number };
    teams: { total: number; soleOwned: number };
    projects: { total: number; underSoleOwnedTeams: number };
    accounts: number;
    sessions: number;
    annotations: number;
    publicShares: number;
    workflows: number;
    workflowVersions: number;
    llmPromptConfigVersions: number;
    annotationQueueMembers: number;
    annotationQueueItems: number;
    auditLogs: number;
  };
  elasticsearch: {
    traces: number;
    dspySteps: number;
    batchEvaluations: number;
    scenarioEvents: number;
  };
  actions: {
    delete: string[];
    removeMembership: string[];
    nullifyReferences: string[];
    anonymize: string[];
  };
  blockers: string[];
}

// ============================================================
// Helpers
// ============================================================

const log = (message: string) => console.log(message);
const logError = (message: string) => console.error(`❌ ${message}`);
const logSuccess = (message: string) => console.log(`✅ ${message}`);

// ============================================================
// Data Collection
// ============================================================

async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
}

// ============================================================
// Data Discovery
// ============================================================

async function getSoleOwnedOrganizations(userId: string) {
  return prisma.organization.findMany({
    where: {
      members: {
        some: { userId }, // User must be a member
        every: { userId }, // AND no other members exist
      },
    },
    select: { id: true, name: true, slug: true },
  });
}

async function getSharedOrganizations(userId: string) {
  return prisma.organization.findMany({
    where: {
      members: {
        some: { userId },
      },
      NOT: {
        members: {
          every: { userId },
        },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { members: true } },
    },
  });
}

async function getSoleOwnedTeams(userId: string) {
  return prisma.team.findMany({
    where: {
      members: {
        some: { userId }, // User must be a member
        every: { userId }, // AND no other members exist
      },
    },
    select: { id: true, name: true, slug: true, organizationId: true },
  });
}

async function getSharedTeams(userId: string) {
  return prisma.team.findMany({
    where: {
      members: {
        some: { userId },
      },
      NOT: {
        members: {
          every: { userId },
        },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { members: true } },
    },
  });
}

async function getProjectsUnderTeams(teamIds: string[]) {
  if (teamIds.length === 0) return [];
  return prisma.project.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true, name: true, slug: true, teamId: true },
  });
}

async function checkBlockingConditions(
  userId: string,
  soleOwnedOrgs: { id: string }[],
  soleOwnedTeams: { id: string; organizationId: string }[]
): Promise<string[]> {
  const blockers: string[] = [];

  // Check if user is sole admin of any shared organization
  const sharedOrgsWhereUserIsSoleAdmin = await prisma.organization.findMany({
    where: {
      members: {
        some: {
          userId,
          role: "ADMIN",
        },
      },
      NOT: {
        members: {
          every: { userId },
        },
      },
    },
    select: { id: true, name: true },
  });

  for (const org of sharedOrgsWhereUserIsSoleAdmin) {
    const otherAdmins = await prisma.organizationUser.count({
      where: {
        organizationId: org.id,
        role: "ADMIN",
        NOT: { userId },
      },
    });
    if (otherAdmins === 0) {
      blockers.push(
        `User is sole ADMIN of shared organization "${org.name}" (${org.id}). Assign another admin first.`
      );
    }
  }

  // Check for teams with other members under sole-owned orgs
  const soleOwnedOrgIds = soleOwnedOrgs.map((o) => o.id);
  const teamsUnderSoleOrgsWithOtherMembers = await prisma.team.findMany({
    where: {
      organizationId: { in: soleOwnedOrgIds },
      members: {
        some: {
          NOT: { userId },
        },
      },
    },
    select: { id: true, name: true },
  });

  for (const team of teamsUnderSoleOrgsWithOtherMembers) {
    blockers.push(
      `Team "${team.name}" (${team.id}) under sole-owned org has other members. Remove them first.`
    );
  }

  return blockers;
}

// ============================================================
// Postgres Deletion
// ============================================================

async function executePostgresDeletion(
  userId: string,
  soleOwnedOrgIds: string[],
  soleOwnedTeamIds: string[],
  projectIds: string[]
) {
  await prisma.$transaction(async (tx) => {
    // Phase 1: Nullify user references on shared entities
    await tx.annotation.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await tx.publicShare.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await tx.workflow.updateMany({
      where: { publishedById: userId },
      data: { publishedById: null },
    });
    // WorkflowVersion.authorId is required - delete versions authored by this user
    // (versions in sole-owned projects will be cascade deleted anyway)
    await tx.workflowVersion.deleteMany({
      where: { authorId: userId },
    });
    await tx.llmPromptConfigVersion.updateMany({
      where: { authorId: userId },
      data: { authorId: null },
    });
    await tx.annotationQueueItem.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await tx.annotationQueueItem.updateMany({
      where: { createdByUserId: userId },
      data: { createdByUserId: null },
    });

    // Anonymize audit logs (keep trail, strip PII)
    await tx.auditLog.updateMany({
      where: { userId },
      data: { userId: "[deleted]", ipAddress: null, userAgent: null },
    });

    // Remove from shared annotation queues
    await tx.annotationQueueMembers.deleteMany({ where: { userId } });

    // Phase 2: Delete sole-owned projects and children
    if (projectIds.length > 0) {
      // Delete project children in correct order
      const configIds = await tx.llmPromptConfig
        .findMany({
          where: { projectId: { in: projectIds } },
          select: { id: true },
        })
        .then((configs) => configs.map((c) => c.id));

      await tx.llmPromptConfigVersion.deleteMany({
        where: { configId: { in: configIds } },
      });
      await tx.llmPromptConfig.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      // Workflow: clear self-references first
      await tx.workflow.updateMany({
        where: { projectId: { in: projectIds } },
        data: { latestVersionId: null, currentVersionId: null },
      });
      await tx.workflowVersion.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.workflow.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await tx.batchEvaluation.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.monitor.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.experiment.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      // Annotation queue children
      const queueIds = await tx.annotationQueue
        .findMany({
          where: { projectId: { in: projectIds } },
          select: { id: true },
        })
        .then((queues) => queues.map((q) => q.id));

      await tx.annotationQueueItem.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.annotationQueueScores.deleteMany({
        where: { annotationQueueId: { in: queueIds } },
      });
      await tx.annotationQueueMembers.deleteMany({
        where: { annotationQueueId: { in: queueIds } },
      });
      await tx.annotationQueue.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      // Dataset children
      await tx.datasetRecord.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.dataset.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      // Other project entities
      await tx.customGraph.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.dashboard.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.trigger.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.annotation.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.publicShare.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.topic.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.cost.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await tx.modelProvider.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      // Delete projects
      await tx.project.deleteMany({
        where: { id: { in: projectIds } },
      });
    }

    // Phase 3: Delete sole-owned teams
    if (soleOwnedTeamIds.length > 0) {
      await tx.teamUser.deleteMany({
        where: { teamId: { in: soleOwnedTeamIds } },
      });
      await tx.team.deleteMany({
        where: { id: { in: soleOwnedTeamIds } },
      });
    }

    // Phase 4: Delete sole-owned organizations
    if (soleOwnedOrgIds.length > 0) {
      await tx.organizationUser.deleteMany({
        where: { organizationId: { in: soleOwnedOrgIds } },
      });
      await tx.organization.deleteMany({
        where: { id: { in: soleOwnedOrgIds } },
      });
    }

    // Phase 5: Remove from shared teams/orgs
    await tx.teamUser.deleteMany({ where: { userId } });
    await tx.organizationUser.deleteMany({ where: { userId } });

    // Phase 6: Delete user-owned entities
    await tx.account.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });

    // Phase 7: Delete user
    await tx.user.delete({ where: { id: userId } });
  });
}

// ============================================================
// Main Execution
// ============================================================

async function generateReport(
  email: string,
  executeMode: boolean
): Promise<DeletionReport> {
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }

  const userId = user.id;

  // Collect org/team data
  const [soleOwnedOrgs, sharedOrgs, soleOwnedTeams, sharedTeams] =
    await Promise.all([
      getSoleOwnedOrganizations(userId),
      getSharedOrganizations(userId),
      getSoleOwnedTeams(userId),
      getSharedTeams(userId),
    ]);

  // Get projects under sole-owned teams
  const soleOwnedTeamIds = soleOwnedTeams.map((t) => t.id);
  const projects = await getProjectsUnderTeams(soleOwnedTeamIds);
  const projectIds = projects.map((p) => p.id);

  // Count all entity references
  const [
    accounts,
    sessions,
    annotations,
    publicShares,
    workflows,
    workflowVersions,
    llmPromptConfigVersions,
    annotationQueueMembers,
    annotationQueueItems,
    auditLogs,
  ] = await Promise.all([
    prisma.account.count({ where: { userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.annotation.count({ where: { userId } }),
    prisma.publicShare.count({ where: { userId } }),
    prisma.workflow.count({ where: { publishedById: userId } }),
    prisma.workflowVersion.count({ where: { authorId: userId } }),
    prisma.llmPromptConfigVersion.count({ where: { authorId: userId } }),
    prisma.annotationQueueMembers.count({ where: { userId } }),
    prisma.annotationQueueItem.count({
      where: { OR: [{ userId }, { createdByUserId: userId }] },
    }),
    prisma.auditLog.count({ where: { userId } }),
  ]);

  // Check blockers
  const blockers = await checkBlockingConditions(
    userId,
    soleOwnedOrgs,
    soleOwnedTeams
  );

  // Count ES documents
  const esCounts = await countEsDocuments(projectIds);

  // Build actions
  const actions: DeletionReport["actions"] = {
    delete: [
      `User ${userId} (${email})`,
      ...soleOwnedOrgs.map((o) => `Organization ${o.id} (${o.name})`),
      ...soleOwnedTeams.map((t) => `Team ${t.id} (${t.name})`),
      ...projects.map((p) => `Project ${p.id} (${p.name})`),
      ...(workflowVersions > 0
        ? [`${workflowVersions} WorkflowVersion (authorId not nullable)`]
        : []),
    ],
    removeMembership: [
      ...sharedOrgs.map(
        (o) =>
          `OrganizationUser ${o.id} (${o.name}, ${o._count.members - 1} remain)`
      ),
      ...sharedTeams.map(
        (t) => `TeamUser ${t.id} (${t.name}, ${t._count.members - 1} remain)`
      ),
    ],
    nullifyReferences: [
      ...(annotations > 0 ? [`${annotations} Annotation.userId`] : []),
      ...(publicShares > 0 ? [`${publicShares} PublicShare.userId`] : []),
      ...(workflows > 0 ? [`${workflows} Workflow.publishedById`] : []),
      ...(llmPromptConfigVersions > 0
        ? [`${llmPromptConfigVersions} LlmPromptConfigVersion.authorId`]
        : []),
    ],
    anonymize: auditLogs > 0 ? [`${auditLogs} AuditLog entries`] : [],
  };

  return {
    userId,
    email,
    mode: executeMode ? "execute" : "dry-run",
    timestamp: new Date().toISOString(),
    counts: {
      organizations: {
        total: soleOwnedOrgs.length + sharedOrgs.length,
        soleOwned: soleOwnedOrgs.length,
      },
      teams: {
        total: soleOwnedTeams.length + sharedTeams.length,
        soleOwned: soleOwnedTeams.length,
      },
      projects: {
        total: projects.length,
        underSoleOwnedTeams: projects.length,
      },
      accounts,
      sessions,
      annotations,
      publicShares,
      workflows,
      workflowVersions,
      llmPromptConfigVersions,
      annotationQueueMembers,
      annotationQueueItems,
      auditLogs,
    },
    elasticsearch: esCounts,
    actions,
    blockers,
  };
}

function printReport(report: DeletionReport) {
  log("");
  log("═══════════════════════════════════════════════════════════════");
  log("                    USER DELETION REPORT");
  log("═══════════════════════════════════════════════════════════════");
  log("");
  log(`Email: ${report.email}`);
  log(`User ID: ${report.userId}`);
  log(`Timestamp: ${report.timestamp}`);
  log(`Mode: ${report.mode === "execute" ? "🔴 EXECUTE" : "🟢 DRY RUN"}`);
  log("");

  // Blockers
  if (report.blockers.length > 0) {
    logError("BLOCKING CONDITIONS:");
    for (const blocker of report.blockers) {
      log(`  ❌ ${blocker}`);
    }
    log("");
  }

  // Counts
  log("📊 ENTITY COUNTS:");
  log(
    `  Organizations: ${report.counts.organizations.total} (sole-owned: ${report.counts.organizations.soleOwned})`
  );
  log(
    `  Teams: ${report.counts.teams.total} (sole-owned: ${report.counts.teams.soleOwned})`
  );
  log(`  Projects: ${report.counts.projects.underSoleOwnedTeams}`);
  log(`  Accounts: ${report.counts.accounts}`);
  log(`  Sessions: ${report.counts.sessions}`);
  log(`  Annotations: ${report.counts.annotations}`);
  log(`  AuditLogs: ${report.counts.auditLogs}`);
  log("");

  // ES counts
  log("📊 ELASTICSEARCH DOCUMENTS:");
  log(`  traces: ${report.elasticsearch.traces}`);
  log(`  dspy-steps: ${report.elasticsearch.dspySteps}`);
  log(`  batch-evaluations: ${report.elasticsearch.batchEvaluations}`);
  log(`  scenario-events: ${report.elasticsearch.scenarioEvents}`);
  log("");

  // Actions
  log("🔧 ACTIONS:");
  log("");

  if (report.actions.delete.length > 0) {
    log("  DELETE:");
    for (const action of report.actions.delete) {
      log(`    🗑️  ${action}`);
    }
    log("");
  }

  if (report.actions.removeMembership.length > 0) {
    log("  REMOVE MEMBERSHIP:");
    for (const action of report.actions.removeMembership) {
      log(`    👋 ${action}`);
    }
    log("");
  }

  if (report.actions.nullifyReferences.length > 0) {
    log("  NULLIFY REFERENCES:");
    for (const action of report.actions.nullifyReferences) {
      log(`    ∅  ${action}`);
    }
    log("");
  }

  if (report.actions.anonymize.length > 0) {
    log("  ANONYMIZE:");
    for (const action of report.actions.anonymize) {
      log(`    🔒 ${action}`);
    }
    log("");
  }

  log("═══════════════════════════════════════════════════════════════");
}

export async function deleteUserData(
  email: string,
  options: { execute?: boolean } = {}
) {
  const executeMode = options.execute ?? false;

  // Initialize SQL logging
  initSqlLog(email);

  // Capture console output for report file
  const reportLines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    reportLines.push(line);
    originalLog(...args);
  };

  try {
    log(`\n🔍 Analyzing user data for: ${email}`);

    const report = await generateReport(email, executeMode);
    printReport(report);

    // Check for blockers
    if (report.blockers.length > 0) {
      logError("Cannot proceed due to blocking conditions.");
      throw new Error("Blocking conditions found");
    }

    if (!executeMode) {
      log("🟢 DRY RUN COMPLETE - NO CHANGES MADE");
      log("");
      log("To execute deletion, run:");
      log(`  pnpm run task gdpr/deleteUserData ${email} --execute`);

      // Write report to file
      writeReportFile(email, reportLines);

      return report;
    }

    // Execute deletion
    log("🔴 EXECUTING DELETION...");
    log("");

    // Re-discover sole-owned entities for deletion
    const soleOwnedOrgs = await getSoleOwnedOrganizations(report.userId);
    const soleOwnedTeams = await getSoleOwnedTeams(report.userId);
    const soleOwnedTeamIds = soleOwnedTeams.map((t) => t.id);
    const projectIds = (await getProjectsUnderTeams(soleOwnedTeamIds)).map(
      (p) => p.id
    );

    // Delete Postgres data
    log("📦 Deleting Postgres data...");
    await executePostgresDeletion(
      report.userId,
      soleOwnedOrgs.map((o) => o.id),
      soleOwnedTeamIds,
      projectIds
    );
    logSuccess("Postgres data deleted");

    // Delete ES data
    if (projectIds.length > 0) {
      log("🔍 Deleting Elasticsearch data...");
      await deleteEsDocuments(projectIds);
      logSuccess("Elasticsearch data deleted");
    }

    // Verify deletion
    log("");
    log("🔍 Verifying deletion...");
    const remainingUser = await prisma.user.findUnique({
      where: { id: report.userId },
    });
    if (remainingUser) {
      logError("User still exists - deletion may have failed!");
      throw new Error("Deletion verification failed");
    }
    logSuccess("User successfully deleted");

    log("");
    log("═══════════════════════════════════════════════════════════════");
    log("                    DELETION COMPLETE");
    log("═══════════════════════════════════════════════════════════════");

    // Write report to file
    writeReportFile(email, reportLines);

    return report;
  } finally {
    // Always restore console.log, even on error
    console.log = originalLog;
  }
}

export default async function execute(email?: string, ...args: string[]) {
  if (!email) {
    throw new Error(
      "Email required. Usage: pnpm run task gdpr/deleteUserData user@example.com [--execute]"
    );
  }

  const executeMode = args.includes("--execute");
  await deleteUserData(email, { execute: executeMode });
}

