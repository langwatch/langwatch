import type { PrismaClient } from "@prisma/client";

export type BackfillResult = {
  provisioned: number;
  skipped: number;
  failed: number;
};

type BackfillProject = { id: string; organizationId: string };

/**
 * Shared sweep for the Langy credential backfills (API key + virtual key):
 * iterate every real user workspace, skip the already-provisioned ones,
 * count would-provisions in dry runs, and never let one bad project abort
 * the sweep. Hidden "internal_governance" routing projects are not
 * user-facing and must never receive Langy credentials, hence the
 * kind: "application" filter.
 */
export async function backfillLangyCredentialPerProject({
  prisma,
  dryRun,
  label,
  logger,
  isProvisioned,
  provision,
}: {
  prisma: PrismaClient;
  dryRun: boolean;
  /** Human-readable credential name for log lines, e.g. "Langy VK". */
  label: string;
  logger: {
    info: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
  isProvisioned: (project: BackfillProject) => Promise<boolean>;
  /**
   * Provision the credential. Return "skipped" when provisioning was a
   * deliberate no-op (e.g. no user to attribute to — first chat will heal).
   */
  provision: (project: BackfillProject) => Promise<"provisioned" | "skipped">;
}): Promise<BackfillResult> {
  const projects = await prisma.project.findMany({
    where: { kind: "application" },
    select: { id: true, team: { select: { organizationId: true } } },
  });

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of projects) {
    const project = { id: row.id, organizationId: row.team.organizationId };
    if (await isProvisioned(project)) {
      skipped++;
      continue;
    }
    if (dryRun) {
      provisioned++; // would-provision count
      continue;
    }
    try {
      const outcome = await provision(project);
      if (outcome === "provisioned") provisioned++;
      else skipped++;
    } catch (err) {
      failed++;
      logger.error(
        { err, projectId: project.id },
        `failed to backfill ${label} for project`,
      );
    }
  }

  logger.info(
    { provisioned, skipped, failed, dryRun },
    `${label} backfill complete`,
  );
  return { provisioned, skipped, failed };
}
