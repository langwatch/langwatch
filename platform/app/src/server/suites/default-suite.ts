/**
 * The Default suite.
 *
 * Every scenario belongs to exactly one suite. A caller that writes a scenario
 * without naming one files it here, and the project's Default suite is created
 * on that first write if it has none.
 *
 * `Scenario.folderId` stays nullable, so the invariant is enforced here on the
 * write path and not by the column: an archived scenario keeps whatever folder
 * it had and may have none, and a code-pushed scenario has no row at all.
 *
 * Default is an ordinary folder-kind suite once it exists. It can be renamed,
 * archived and run like any other. A project whose Default was renamed or
 * archived and then writes an unfiled scenario gets a fresh Default, because
 * the scenario still needs a home.
 *
 * Existing projects were brought to this state by the 20260825120004 migration.
 *
 * @see specs/suites/default-suite.feature
 */

import { nanoid } from "nanoid";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { isUniqueConstraintError } from "~/server/utils/prismaErrors";
import { pickFreeSlug } from "./slug";

/** The name the migration wrote and the write path recreates. */
export const DEFAULT_SUITE_NAME = "Default";

/** The slug the Default suite takes when the project has it free. */
export const DEFAULT_SUITE_SLUG = "default";

/** The Prisma surface this module needs; a transaction client fits. */
export type DefaultSuiteClient = Pick<
  Prisma.TransactionClient,
  "simulationSuite"
>;

/**
 * The project's Default suite, or null.
 *
 * Matched by name rather than by a reserved label, so a folder a person named
 * "Default" themselves is the project's Default rather than a second one beside
 * it. The oldest wins when a project holds two.
 */
export async function findDefaultSuite(params: {
  projectId: string;
  prisma: DefaultSuiteClient;
}): Promise<{ id: string } | null> {
  return params.prisma.simulationSuite.findFirst({
    where: {
      projectId: params.projectId,
      kind: "folder",
      archivedAt: null,
      name: { equals: DEFAULT_SUITE_NAME, mode: "insensitive" },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The id of the project's Default suite, creating it when the project has none.
 *
 * Call this OUTSIDE the transaction that writes the scenario. The create can
 * lose a race with a concurrent one, and Postgres aborts a transaction on the
 * unique violation, so the retry cannot happen inside the caller's transaction.
 */
export async function ensureDefaultSuiteId(params: {
  projectId: string;
  prisma: PrismaClient;
}): Promise<string> {
  const existing = await findDefaultSuite(params);
  if (existing) return existing.id;

  try {
    return await createDefaultSuite({
      projectId: params.projectId,
      slug: DEFAULT_SUITE_SLUG,
      prisma: params.prisma,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // Either a concurrent write created the Default suite, or another suite of
    // this project already owns the "default" slug. Reading first tells the two
    // apart, and costs one query on a path that runs once per project.
    const raced = await findDefaultSuite(params);
    if (raced) return raced.id;
    return await createDefaultSuite({
      projectId: params.projectId,
      slug: await pickFreeDefaultSlug(params),
      prisma: params.prisma,
    });
  }
}

async function pickFreeDefaultSlug(params: {
  projectId: string;
  prisma: PrismaClient;
}): Promise<string> {
  const rows = await params.prisma.simulationSuite.findMany({
    where: {
      projectId: params.projectId,
      slug: { startsWith: DEFAULT_SUITE_SLUG },
      archivedAt: null,
    },
    select: { slug: true },
  });
  return pickFreeSlug({
    baseSlug: DEFAULT_SUITE_SLUG,
    takenSlugs: rows.map((row) => row.slug),
  });
}

async function createDefaultSuite(params: {
  projectId: string;
  slug: string;
  prisma: DefaultSuiteClient;
}): Promise<string> {
  const created = await params.prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid()}`,
      projectId: params.projectId,
      name: DEFAULT_SUITE_NAME,
      slug: params.slug,
      kind: "folder",
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
    },
    select: { id: true },
  });
  return created.id;
}
