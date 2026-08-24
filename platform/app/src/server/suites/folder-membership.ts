/**
 * The one place folder membership is derived.
 *
 * The invariant, for every non-archived scenario:
 *
 *   Scenario.folderId = S  ⟺  S.kind = "folder" ∧ S.scenarioIds ∋ scenario.id
 *
 * Scenario.folderId is the source of truth; SimulationSuite.scenarioIds is a
 * denormalized copy kept for the run path and the set-id queries. Every write
 * that can change membership calls {@link reconcileFolderMembership} inside
 * its own transaction. Nothing adds or removes a single scenarioIds entry by
 * hand.
 *
 * Constraint, not covered here on purpose: archiving a folder skips the
 * reconcile, so the archived folder keeps the membership it had as a readable
 * snapshot. That is the one place the invariant is deliberately suspended.
 *
 * @see specs/suites/folder-membership-invariant.feature
 */

import type { Prisma } from "~/generated/prisma/client";
import { ScenarioFolderNotFoundError } from "../scenarios/errors";

/** The Prisma client surface the reconcile needs; a transaction client fits. */
export type FolderMembershipClient = Pick<
  Prisma.TransactionClient,
  "scenario" | "simulationSuite"
>;

/**
 * Recomputes a folder's scenarioIds from the scenarios that name it.
 *
 * A full recompute, never an incremental add/remove: folders hold tens of
 * scenarios, so the recompute is cheap, and one definition of the derived
 * value cannot drift the way five call sites would.
 *
 * Only active scenarios count. An archived scenario keeps its folderId so a
 * later restore can put it back, but it is not a member while archived.
 */
export async function reconcileFolderMembership({
  projectId,
  folderId,
  tx,
}: {
  projectId: string;
  folderId: string;
  tx: FolderMembershipClient;
}): Promise<void> {
  const members = await tx.scenario.findMany({
    where: { projectId, folderId, archivedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  await tx.simulationSuite.update({
    where: { id: folderId, projectId },
    data: { scenarioIds: members.map((member) => member.id) },
  });
}

/**
 * Checks that folderId names a suite a scenario may be filed into: same
 * project, kind "folder", not archived.
 *
 * @throws {ScenarioFolderNotFoundError} when it names anything else — a
 *   custom run plan, an archived folder, another project's folder, or nothing.
 */
export async function assertAssignableFolder({
  projectId,
  folderId,
  tx,
}: {
  projectId: string;
  folderId: string;
  tx: FolderMembershipClient;
}): Promise<void> {
  const folder = await tx.simulationSuite.findFirst({
    where: {
      id: folderId,
      projectId,
      kind: "folder",
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!folder) {
    throw new ScenarioFolderNotFoundError();
  }
}
