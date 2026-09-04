import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:trace-destination-report");

/** Keys read per round trip: few round trips, and never a page big enough to
 *  be what runs an operator's laptop out of memory. */
const KEY_PAGE_SIZE = 1_000;

export const TRACE_DESTINATION_RESOLUTIONS = [
  "explicit-live",
  "explicit-archived",
  "explicit-missing",
  "single-scope",
  "governance",
  "null",
] as const;

export type TraceDestinationResolution = (typeof TRACE_DESTINATION_RESOLUTIONS)[number];

const PROJECT_SELECT = {
  id: true,
  kind: true,
  archivedAt: true,
  createdAt: true,
  team: { select: { organizationId: true } },
} as const;

const KEY_SELECT = {
  id: true,
  organizationId: true,
  traceProjectId: true,
  scopes: { select: { scopeType: true, scopeId: true } },
} as const;

export type TraceDestinationProjectRow = Prisma.ProjectGetPayload<{
  select: typeof PROJECT_SELECT;
}>;

export type TraceDestinationKeyRow = Prisma.VirtualKeyGetPayload<{
  select: typeof KEY_SELECT;
}>;

/**
 * Read-only, and PICKED from the real client rather than re-declared: three
 * delegates, one method each, so a typed `PrismaClient` satisfies it with no
 * cast and this stays visibly SELECT and nothing else.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

export type TraceDestinationReportDatabase = {
  project: Delegate<"project", "findMany">;
  organization: Delegate<"organization", "findMany">;
  virtualKey: Delegate<"virtualKey", "findMany">;
};

export type TraceDestinationReport = Readonly<{
  counts: Readonly<Record<TraceDestinationResolution, number>>;
  total: number;
  organizationsWithoutGovernanceProject: number;
  /** The number that gates the migration: keys that would end with nothing. */
  organizationsWithDestinationlessKeys: readonly string[];
}>;

/**
 * Answers the one question the stored-trace-destination backfill cannot answer
 * for itself: which keys it would leave with no destination at all. Ported from
 * main's `report-trace-destination-backfill.ts`.
 */
export async function reportTraceDestinationBackfill({
  database,
}: {
  database: TraceDestinationReportDatabase;
}): Promise<TraceDestinationReport> {
  const projects = await database.project.findMany({
    select: PROJECT_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byId = new Map(projects.map((project) => [project.id, project]));
  const governanceByOrganization = oldestLiveGovernanceByOrganization(projects);

  const counts = Object.fromEntries(
    TRACE_DESTINATION_RESOLUTIONS.map((resolution) => [resolution, 0]),
  ) as Record<TraceDestinationResolution, number>;
  const destinationless = new Set<string>();
  let total = 0;

  // Keyset pagination rather than OFFSET, which under concurrent writes hands
  // back the same row twice or skips one; a key inserted behind the cursor
  // while this runs is simply missed, and the counts are a shape, not a ledger.
  let cursor: string | null = null;
  for (;;) {
    // Annotated, not inferred: the page's own type would otherwise be read
    // out of a call whose `where` reads the cursor this loop assigns FROM the
    // page, and a self-referencing initializer infers `any` (TS7022).
    // `undefined` rather than a conditional spread — Prisma reads an absent
    // predicate exactly that way.
    const page: TraceDestinationKeyRow[] = await database.virtualKey.findMany({
      where: cursor === null ? undefined : { id: { gt: cursor } },
      select: KEY_SELECT,
      orderBy: { id: "asc" },
      take: KEY_PAGE_SIZE,
    });
    if (page.length === 0) break;
    for (const key of page) {
      const resolution = classify({ key, byId, governanceByOrganization });
      counts[resolution] += 1;
      if (resolution === "null") destinationless.add(key.organizationId);
    }
    total += page.length;
    cursor = page[page.length - 1]?.id ?? null;
    if (page.length < KEY_PAGE_SIZE || cursor === null) break;
  }

  // Read from Organization, not from the projects: an organization with no
  // projects at all has no governance project either, and counting it off the
  // project rows would leave it out of the very number it belongs in.
  const organizations = await database.organization.findMany({ select: { id: true } });
  const report: TraceDestinationReport = {
    counts,
    total,
    organizationsWithoutGovernanceProject: organizations.filter(
      (organization) => !governanceByOrganization.has(organization.id),
    ).length,
    organizationsWithDestinationlessKeys: [...destinationless].sort(),
  };
  logger.info({ report }, "trace destination backfill report");
  return report;
}

/** Oldest live governance project per organization — the rule's own order. */
function oldestLiveGovernanceByOrganization(
  projects: readonly TraceDestinationProjectRow[],
): Map<string, string> {
  const byOrganization = new Map<string, string>();
  for (const project of projects) {
    if (project.kind !== "internal_governance" || project.archivedAt !== null) continue;
    const organizationId = project.team.organizationId;
    if (byOrganization.has(organizationId)) continue;
    byOrganization.set(organizationId, project.id);
  }
  return byOrganization;
}

function classify({
  key,
  byId,
  governanceByOrganization,
}: {
  key: TraceDestinationKeyRow;
  byId: Map<string, TraceDestinationProjectRow>;
  governanceByOrganization: Map<string, string>;
}): TraceDestinationResolution {
  if (!key.traceProjectId) return withFallback(null, { key, byId, governanceByOrganization });
  const named = byId.get(key.traceProjectId);
  // A pointer at another organization's project reads the same way as one at a
  // project that is gone: neither is a destination this key may have.
  if (!named || named.team.organizationId !== key.organizationId) {
    return withFallback("explicit-missing", { key, byId, governanceByOrganization });
  }
  if (named.archivedAt !== null) {
    return withFallback("explicit-archived", { key, byId, governanceByOrganization });
  }
  return "explicit-live";
}

/**
 * What answers for a key whose named destination did not, reported under the
 * reason it fell through when there is one. `null` always wins over the
 * reason: a destinationless key is the number that gates the migration.
 */
function withFallback(
  reason: TraceDestinationResolution | null,
  {
    key,
    byId,
    governanceByOrganization,
  }: {
    key: TraceDestinationKeyRow;
    byId: Map<string, TraceDestinationProjectRow>;
    governanceByOrganization: Map<string, string>;
  },
): TraceDestinationResolution {
  const projectScopes = key.scopes.filter((scope) => scope.scopeType === "PROJECT");
  const only = projectScopes.length === 1 ? byId.get(projectScopes[0]?.scopeId ?? "") : undefined;
  if (only && only.archivedAt === null && only.team.organizationId === key.organizationId) {
    return reason ?? "single-scope";
  }
  if (governanceByOrganization.has(key.organizationId)) return reason ?? "governance";
  return "null";
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * trace-destination-report`.
 */
export class TraceDestinationReportTask extends Task {
  readonly name = "trace-destination-report";
  readonly description =
    "Reports which virtual keys the stored-trace-destination backfill would leave without a destination.";

  private constructor(private readonly database: () => TraceDestinationReportDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => TraceDestinationReportDatabase;
  }): TraceDestinationReportTask {
    return new TraceDestinationReportTask(database);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await reportTraceDestinationBackfill({ database: this.database() });
  }
}
