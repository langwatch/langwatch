import {
  type PIIRedactionLevel,
  type PrismaClient,
  type ProjectSensitiveDataVisibilityLevel,
} from "@prisma/client";

import {
  dataPrivacyConfigSchema,
  type CategorySetting,
  type DataPrivacyConfig,
  type PiiLevel,
} from "../dataPrivacy.types";
import { DataPrivacyPolicyRepository } from "../dataPrivacyPolicy.repository";

/**
 * Backfill the legacy privacy controls into the unified scoped policy so a
 * customer keeps their exact posture after the upgrade:
 *   - Organization.governanceLogContentMode → an organization drop rule
 *   - Project.capturedInput/OutputVisibility → a project restrict rule
 *   - Project.piiRedactionLevel            → a project PII level
 * A control already at its default produces no rule; the resolver then returns
 * the platform default for that project, which equals the old behavior.
 *
 * The mappers are pure so they can be unit-tested; the routine applies them
 * through the repository (idempotent upsert per scope), optionally scoped to one
 * organization so a migration can run incrementally and tests stay isolated.
 */

const DROP: CategorySetting = { disposition: "drop" };

/** Map an organization's legacy content mode to a drop config (or null = no rule). */
export function mapLegacyGovernanceToConfig(
  mode: string,
): DataPrivacyConfig | null {
  if (mode === "strip_io") {
    return { categories: { input: DROP, output: DROP, system: DROP } };
  }
  if (mode === "strip_all") {
    return {
      categories: { input: DROP, output: DROP, system: DROP, tools: DROP },
    };
  }
  return null;
}

function visibilityToCategory(
  visibility: ProjectSensitiveDataVisibilityLevel,
): CategorySetting | null {
  switch (visibility) {
    case "VISIBLE_TO_ADMIN":
      return { disposition: "restrict", audience: { admins: true } };
    case "REDACTED_TO_ALL":
      return { disposition: "restrict", audience: {} };
    default:
      // VISIBLE_TO_ALL is the default capture posture — no rule needed.
      return null;
  }
}

function piiToLevel(level: PIIRedactionLevel): PiiLevel | null {
  switch (level) {
    case "STRICT":
      return "strict";
    case "DISABLED":
      return "disabled";
    default:
      // ESSENTIAL is the platform default — no rule needed.
      return null;
  }
}

/** Map a project's legacy visibility + PII settings to a config (or null = no rule). */
export function mapLegacyProjectToConfig(legacy: {
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel;
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel;
  piiRedactionLevel: PIIRedactionLevel;
}): DataPrivacyConfig | null {
  const config: DataPrivacyConfig = {};

  const input = visibilityToCategory(legacy.capturedInputVisibility);
  const output = visibilityToCategory(legacy.capturedOutputVisibility);
  if (input || output) {
    config.categories = {};
    if (input) config.categories.input = input;
    if (output) config.categories.output = output;
  }

  const level = piiToLevel(legacy.piiRedactionLevel);
  if (level) config.pii = { level };

  return Object.keys(config).length > 0 ? config : null;
}

export interface BackfillResult {
  organizationRules: number;
  projectRules: number;
}

/**
 * Run the legacy → unified-policy backfill. Scoped to one organization when
 * `organizationId` is given (incremental rollout, isolated tests); otherwise it
 * sweeps every organization and project. Idempotent: re-running upserts the same
 * rows.
 */
export async function backfillLegacyPrivacy({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId?: string;
}): Promise<BackfillResult> {
  const repository = new DataPrivacyPolicyRepository(prisma);
  let organizationRules = 0;
  let projectRules = 0;

  const organizations = await prisma.organization.findMany({
    where: {
      governanceLogContentMode: { not: "full" },
      ...(organizationId ? { id: organizationId } : {}),
    },
    select: { id: true, governanceLogContentMode: true },
  });
  for (const organization of organizations) {
    const config = mapLegacyGovernanceToConfig(
      organization.governanceLogContentMode,
    );
    if (!config) continue;
    await repository.upsertForScope({
      organizationId: organization.id,
      scope: { scopeType: "ORGANIZATION", scopeId: organization.id },
      personalOnly: false,
      config: dataPrivacyConfigSchema.parse(config),
    });
    organizationRules++;
  }

  const projects = await prisma.project.findMany({
    where: {
      ...(organizationId
        ? { team: { organizationId } }
        : {}),
      OR: [
        { capturedInputVisibility: { not: "VISIBLE_TO_ALL" } },
        { capturedOutputVisibility: { not: "VISIBLE_TO_ALL" } },
        { piiRedactionLevel: { not: "ESSENTIAL" } },
      ],
    },
    select: {
      id: true,
      capturedInputVisibility: true,
      capturedOutputVisibility: true,
      piiRedactionLevel: true,
      team: { select: { organizationId: true } },
    },
  });
  for (const project of projects) {
    const config = mapLegacyProjectToConfig(project);
    if (!config) continue;
    await repository.upsertForScope({
      organizationId: project.team.organizationId,
      scope: { scopeType: "PROJECT", scopeId: project.id },
      personalOnly: false,
      config: dataPrivacyConfigSchema.parse(config),
    });
    projectRules++;
  }

  return { organizationRules, projectRules };
}
