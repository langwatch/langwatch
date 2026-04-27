/**
 * Hidden Governance Project — internal routing/tenancy artifact.
 *
 * Per master_orchestrator + rchaves directive 2026-04-27 (unified-trace
 * branch correction):
 *   - IngestionSource ingest data lives in the existing trace pipeline
 *     (recorded_spans + log_records), tagged with origin metadata.
 *   - Project tenancy is reused for RBAC + retention; the receiver
 *     resolves a hidden per-org Project (kind = "internal_governance")
 *     to anchor those writes.
 *   - The hidden Governance Project is INTERNAL ONLY — never appears in
 *     ProjectSelector / project list / /api/v1/projects / billing
 *     exports / RBAC pickers. The Layer-1 filter at
 *     PrismaOrganizationRepository.getAllForUser (commit 94426716e)
 *     enforces the bulk of this; per-consumer assertions land in Layer 2.
 *
 * Lifecycle: lazily ensured on first need — typically the first
 * IngestionSource mint per org. Any later callsite (anomaly reactor,
 * receiver, UI sub-route) calls the SAME helper. There is no other
 * lazy-create path. Feature-flag activation alone does NOT create a
 * Governance Project; the user must mint a real governance entity
 * first.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *   - specs/ai-gateway/governance/ui-contract.feature
 *   - specs/ai-gateway/governance/receiver-shapes.feature
 *   - specs/ai-gateway/governance/retention.feature
 */
import type { PrismaClient, Project } from "@prisma/client";
import { nanoid } from "nanoid";

import { generateApiKey } from "~/server/utils/apiKeyGenerator";

/** Canonical Project.kind values. Free-form string in the DB column for
 *  extensibility; this constant is the source of truth in TS. */
export const PROJECT_KIND = {
  APPLICATION: "application",
  INTERNAL_GOVERNANCE: "internal_governance",
} as const;
export type ProjectKind = (typeof PROJECT_KIND)[keyof typeof PROJECT_KIND];

/**
 * Resolve the org's hidden Governance Project, creating one on first
 * call. Idempotent — concurrent callers may briefly race; the
 * org-scoped composite-unique guard on (teamId, kind) collapses the
 * race to a single row at the next read.
 *
 * The project is attached to the org's oldest team (any team works for
 * routing — RBAC is enforced via project membership, which the Layer-1
 * filter already guarantees won't include the Governance Project for
 * any user-visible flow).
 */
export async function ensureHiddenGovernanceProject(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Project> {
  const existing = await prisma.project.findFirst({
    where: {
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      team: { organizationId },
      archivedAt: null,
    },
  });
  if (existing) return existing;

  const team = await prisma.team.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (!team) {
    throw new Error(
      `Cannot ensure Governance Project for org ${organizationId}: ` +
        "org has no team. The fresh-admin onboarding flow must create at " +
        "least one team before any IngestionSource can be minted.",
    );
  }

  // Slug must be globally unique. Org id keeps it stable + scoped.
  const slug = `governance-${organizationId}`;
  // Re-check by slug in case a concurrent request just won the race.
  const bySlug = await prisma.project.findUnique({ where: { slug } });
  if (bySlug && bySlug.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) {
    return bySlug;
  }

  return prisma.project.create({
    data: {
      id: nanoid(),
      name: "Governance (internal)",
      slug,
      apiKey: generateApiKey(),
      teamId: team.id,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      // Internal-only — these aren't real "I'm building an app"
      // language/framework signals, but the Project model requires
      // them. Stable values keep the row recognisable in operator
      // queries.
      language: "internal",
      framework: "governance",
      // PII redaction stays at the org's effective default; receiver
      // can override per-source if compliance retention demands it.
      // The trace pipeline reads piiRedactionLevel at write time.
      piiRedactionLevel: "ESSENTIAL",
      // Trace sharing disabled — governance data must not be sharable
      // out of the org's RBAC perimeter via public-share links.
      traceSharingEnabled: false,
    },
  });
}
