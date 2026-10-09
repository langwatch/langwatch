/**
 * The one place test suite membership is derived.
 *
 * The invariant, for every non-archived scenario:
 *
 *   Scenario.testSuiteId = S  ⟺  S.kind = "test_suite" ∧ S.scenarioIds ∋ scenario.id
 *
 * Scenario.testSuiteId is the source of truth; SimulationSuite.scenarioIds is a
 * denormalized copy kept for the run path and the set-id queries. Every write
 * that can change membership calls {@link reconcileTestSuiteMembership} inside
 * its own transaction. Nothing adds or removes a single scenarioIds entry by
 * hand.
 *
 * Constraint, not covered here on purpose: archiving a test suite skips the
 * reconcile, so the archived test suite keeps the membership it had as a readable
 * snapshot. That is the one place the invariant is deliberately suspended.
 *
 * @see specs/suites/test-suite-membership-invariant.feature
 */

import type { Prisma } from "~/generated/prisma/client";
import { ScenarioTestSuiteNotFoundError } from "../scenarios/errors";

/**
 * The Prisma client surface the reconcile needs; a transaction client fits.
 *
 * `$executeRaw` is in the list because the reconcile takes the test suite's row
 * lock before it reads. Nothing else here needs raw SQL.
 */
export type TestSuiteMembershipClient = Pick<
  Prisma.TransactionClient,
  "scenario" | "simulationSuite" | "$executeRaw"
>;

/**
 * Recomputes a test suite's scenarioIds from the scenarios that name it.
 *
 * A full recompute, never an incremental add/remove: test suites hold tens of
 * scenarios, so the recompute is cheap, and one definition of the derived
 * value cannot drift the way five call sites would.
 *
 * Only active scenarios count. An archived scenario keeps its testSuiteId so a
 * later restore can put it back, but it is not a member while archived.
 */
export async function reconcileTestSuiteMembership({
  projectId,
  testSuiteId,
  tx,
}: {
  projectId: string;
  testSuiteId: string;
  tx: TestSuiteMembershipClient;
}): Promise<void> {
  // The test suite's row lock comes FIRST, before the read that decides what to
  // write. Without it two transactions filing different scenarios into the same
  // test suite both read the list as it was, and the one that commits second
  // writes a list that has never held the other's scenario: a committed scenario
  // absent from its own test suite, with nothing to report it.
  //
  // Every writer takes the same lock in the same place, so they serialize on
  // the test suite rather than deadlocking against each other. A test suite holds
  // tens of scenarios, so the section under the lock is one indexed read and one
  // update.
  await tx.$executeRaw`SELECT id FROM "SimulationSuite" WHERE id = ${testSuiteId} AND "projectId" = ${projectId} FOR UPDATE`;

  const members = await tx.scenario.findMany({
    where: { projectId, testSuiteId, archivedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  await tx.simulationSuite.update({
    where: { id: testSuiteId, projectId },
    data: { scenarioIds: members.map((member) => member.id) },
  });
}

/**
 * Checks that testSuiteId names a suite a scenario may be filed into: same
 * project, kind "test_suite", not archived.
 *
 * @throws {ScenarioTestSuiteNotFoundError} when it names anything else, such as a
 *   run plan, an archived test suite, another project's test suite, or nothing.
 */
export async function assertAssignableTestSuite({
  projectId,
  testSuiteId,
  tx,
}: {
  projectId: string;
  testSuiteId: string;
  tx: TestSuiteMembershipClient;
}): Promise<void> {
  const testSuite = await tx.simulationSuite.findFirst({
    where: {
      id: testSuiteId,
      projectId,
      kind: "test_suite",
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!testSuite) {
    throw new ScenarioTestSuiteNotFoundError();
  }
}
