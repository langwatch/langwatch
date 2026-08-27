/**
 * The one place a run plan's scope becomes a list of test cases.
 *
 * A dynamic scope is a rule, so the list it means changes as cases are
 * written, filed, labelled and archived. It is resolved when the run starts,
 * and the plan's `scenarioIds` cache is refreshed from the same read, inside
 * the same transaction, so what the plan reads back is what the run covered.
 *
 * The suite's row lock comes first, before the read that decides what to
 * write, for the reason it does in folder-membership.ts: two runs of the same
 * plan would otherwise each write a list from a read the other has already
 * moved past.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */

import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { isDynamicScope, type SuiteScope } from "@langwatch/suite-contract";

/** The Prisma surface the resolve needs; a transaction client fits. */
export type ScopeMembershipClient = Pick<
  Prisma.TransactionClient,
  "scenario" | "simulationSuite" | "$executeRaw"
>;

/**
 * Resolves a dynamic scope to the project's matching active scenario ids and
 * writes the result onto the plan, under the plan's row lock.
 *
 * Static scopes never reach here: a plan of mode "cases" already holds its
 * list, and a folder's membership is `Scenario.folderId`.
 */
export async function resolveAndCacheScope({
  projectId,
  suiteId,
  scope,
  tx,
}: {
  projectId: string;
  suiteId: string;
  scope: SuiteScope;
  tx: ScopeMembershipClient;
}): Promise<string[]> {
  await tx.$executeRaw`SELECT id FROM "SimulationSuite" WHERE id = ${suiteId} AND "projectId" = ${projectId} FOR UPDATE`;

  const rows = await tx.scenario.findMany({
    where: {
      projectId,
      archivedAt: null,
      ...(scope.mode === "folders" && { folderId: { in: scope.folderIds } }),
      ...(scope.mode === "labels" && { labels: { hasSome: scope.labels } }),
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const scenarioIds = rows.map((row) => row.id);

  await tx.simulationSuite.update({
    where: { id: suiteId, projectId },
    data: { scenarioIds },
  });

  return scenarioIds;
}

/**
 * The test cases a run of this plan covers.
 *
 * A dynamic scope is resolved and cached in one transaction; a static one is
 * the list the plan already holds, returned untouched.
 */
export async function readScopeMembership({
  projectId,
  suiteId,
  scope,
  storedScenarioIds,
  prisma,
}: {
  projectId: string;
  suiteId: string;
  scope: SuiteScope;
  storedScenarioIds: string[];
  prisma: PrismaClient;
}): Promise<string[]> {
  if (!isDynamicScope(scope)) return storedScenarioIds;
  return prisma.$transaction((tx) => resolveAndCacheScope({ projectId, suiteId, scope, tx }));
}
