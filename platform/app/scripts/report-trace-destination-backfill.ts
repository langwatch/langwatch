/**
 * READ-ONLY. Reports what the stored-trace-destination backfill would do.
 *
 * This script issues SELECT queries only. It performs no INSERT, UPDATE or
 * DELETE, opens no transaction, and is safe to point at production: the keys
 * are walked a page at a time and folded into counters as they arrive, so what
 * it holds in memory is one page plus the organization's projects, whatever the
 * size of the instance.
 * Its whole job is to answer, before the migration runs, the one question the
 * backfill cannot answer for itself: are there keys it will leave without a
 * destination, and are there organizations that cannot give it one.
 *
 * Every key is classified by the rule that would answer for it, in the same
 * order the migration applies them:
 *
 *   explicit-live      the key names a live project of its own organization,
 *                      and keeps it
 *   explicit-archived  the key names a project the customer deleted
 *   explicit-missing   the key names a project that does not exist, or one of
 *                      another organization
 *   single-scope       no usable name, exactly one live PROJECT access scope
 *   governance         no usable name and nothing to take from the scopes, so
 *                      the organization's oldest live governance project
 *   null               none of the above: the organization has no live
 *                      governance project, so there is nothing to write
 *
 * The last row is the one that gates the merge. A non-zero `null` count means
 * keys whose traces the gateway already drops, and the data is fixed by hand
 * before the migration, not by the migration.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/report-trace-destination-backfill.ts
 */
import { PrismaClient } from "@prisma/client";

type Resolution =
  | "explicit-live"
  | "explicit-archived"
  | "explicit-missing"
  | "single-scope"
  | "governance"
  | "null";

const RESOLUTIONS: Resolution[] = [
  "explicit-live",
  "explicit-archived",
  "explicit-missing",
  "single-scope",
  "governance",
  "null",
];

/** Keys read per round trip. Big enough to be few round trips, small enough
 * that a page is never the thing that runs an operator's laptop out of RAM. */
const KEY_PAGE_SIZE = 1_000;

type ProjectRow = {
  id: string;
  organizationId: string;
  kind: string;
  archived: boolean;
};

async function main(): Promise<void> {
  // A client of its own rather than the app's singleton: this runs against a
  // DATABASE_URL the operator points at, and must not pick up whatever the
  // surrounding environment had configured.
  const prisma = new PrismaClient();
  try {
    const projects = await loadProjects(prisma);
    const byId = new Map(projects.map((project) => [project.id, project]));
    const governanceByOrg = oldestLiveGovernanceByOrg(projects);

    const counts = new Map<Resolution, number>(
      RESOLUTIONS.map((resolution) => [resolution, 0]),
    );
    const orgsWithKeysNeedingGovernance = new Set<string>();
    let total = 0;

    // Keyset pagination on the primary key: a full instance's worth of keys
    // never has to fit in memory at once, and the walk cannot skip or repeat
    // a row the way an OFFSET walk can under concurrent writes.
    let cursor: string | null = null;
    for (;;) {
      const page: {
        id: string;
        organizationId: string;
        traceProjectId: string | null;
        scopes: { scopeType: string; scopeId: string }[];
      }[] = await prisma.virtualKey.findMany({
        ...(cursor ? { where: { id: { gt: cursor } } } : {}),
        select: {
          id: true,
          organizationId: true,
          traceProjectId: true,
          scopes: { select: { scopeType: true, scopeId: true } },
        },
        orderBy: { id: "asc" },
        take: KEY_PAGE_SIZE,
      });
      if (page.length === 0) break;
      for (const key of page) {
        const resolution = classify({ key, byId, governanceByOrg });
        counts.set(resolution, (counts.get(resolution) ?? 0) + 1);
        if (resolution === "null") {
          orgsWithKeysNeedingGovernance.add(key.organizationId);
        }
      }
      total += page.length;
      cursor = page[page.length - 1]!.id;
      if (page.length < KEY_PAGE_SIZE) break;
    }

    // Read from Organization, not from the projects: an organization with no
    // projects at all has no governance project either, and counting it off
    // the project rows would leave it out of the very number it belongs in.
    const organizations = await prisma.organization.findMany({
      select: { id: true },
    });
    const orgsMissingGovernance = organizations
      .map((organization) => organization.id)
      .filter((organizationId) => !governanceByOrg.has(organizationId));

    console.log("virtual keys by would-be resolution");
    for (const resolution of RESOLUTIONS) {
      console.log(`  ${resolution.padEnd(18)} ${counts.get(resolution) ?? 0}`);
    }
    console.log(`  ${"total".padEnd(18)} ${total}`);
    console.log("");
    console.log(
      `organizations with no live governance project: ${orgsMissingGovernance.length}`,
    );
    console.log(
      `  of which have keys that would be left with no destination: ${orgsWithKeysNeedingGovernance.size}`,
    );
    for (const organizationId of [...orgsWithKeysNeedingGovernance].sort()) {
      console.log(`    ${organizationId}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function loadProjects(prisma: PrismaClient): Promise<ProjectRow[]> {
  const rows = await prisma.project.findMany({
    select: {
      id: true,
      kind: true,
      archivedAt: true,
      createdAt: true,
      team: { select: { organizationId: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.team.organizationId,
    kind: row.kind,
    archived: row.archivedAt !== null,
  }));
}

/** Oldest live governance project per organization, the rule's own order. */
function oldestLiveGovernanceByOrg(
  projects: ProjectRow[],
): Map<string, string> {
  const byOrg = new Map<string, string>();
  for (const project of projects) {
    if (project.kind !== "internal_governance" || project.archived) continue;
    if (byOrg.has(project.organizationId)) continue;
    byOrg.set(project.organizationId, project.id);
  }
  return byOrg;
}

function classify({
  key,
  byId,
  governanceByOrg,
}: {
  key: {
    organizationId: string;
    traceProjectId: string | null;
    scopes: { scopeType: string; scopeId: string }[];
  };
  byId: Map<string, ProjectRow>;
  governanceByOrg: Map<string, string>;
}): Resolution {
  if (key.traceProjectId) {
    const named = byId.get(key.traceProjectId);
    if (!named || named.organizationId !== key.organizationId) {
      // A pointer at another organization's project reads the same way as one
      // at a project that is gone: neither is a destination this key may have.
      return withFallback("explicit-missing", { key, byId, governanceByOrg });
    }
    if (named.archived) {
      return withFallback("explicit-archived", { key, byId, governanceByOrg });
    }
    return "explicit-live";
  }
  return withFallback(null, { key, byId, governanceByOrg });
}

/**
 * What answers for a key whose named destination did not. Reported under the
 * name of the reason it fell through when there is one, because "how many
 * keys point at a deleted project" is the number an operator is looking for.
 * `null` always wins over the reason: a key that ends up with no destination
 * is the number that gates the migration, and it must not hide inside
 * another bucket.
 */
function withFallback(
  reason: Resolution | null,
  {
    key,
    byId,
    governanceByOrg,
  }: {
    key: {
      organizationId: string;
      scopes: { scopeType: string; scopeId: string }[];
    };
    byId: Map<string, ProjectRow>;
    governanceByOrg: Map<string, string>;
  },
): Resolution {
  const projectScopes = key.scopes.filter(
    (scope) => scope.scopeType === "PROJECT",
  );
  if (projectScopes.length === 1) {
    const scoped = byId.get(projectScopes[0]!.scopeId);
    if (
      scoped &&
      !scoped.archived &&
      scoped.organizationId === key.organizationId
    ) {
      return reason ?? "single-scope";
    }
  }
  if (governanceByOrg.has(key.organizationId)) return reason ?? "governance";
  return "null";
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
