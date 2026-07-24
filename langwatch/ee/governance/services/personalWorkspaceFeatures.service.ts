// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PersonalWorkspaceFeaturesService — owns the per-feature unlock
 * bundle on personal projects.
 *
 * Personal workspaces ship minimal-by-default: Traces / My Usage /
 * Sessions / Settings only. The four "library" features (Evaluations
 * / Datasets / Annotations / Automations) are hidden behind a single
 * checkbox in `/me/configure → Workspace features` (or unlocked
 * progressively via the click-to-enable modal in the Traces Explorer).
 *
 * Storage is per-feature JSON (`Project.personalFeatures`) so future
 * granular toggles can unbundle without a migration. Today the only
 * UX action flips all four atomically (`enableAll` / `disableAll`).
 *
 * Bundle is a UI/nav predicate only — the underlying tRPC routers
 * stay open even when the bundle is off. Disabling does NOT delete
 * data: rows persist and rehydrate on re-enable.
 *
 * Authorization: every mutation is gated to the personal project's
 * `ownerUserId` at the service layer. No org-level RBAC needed
 * because the personal project IS the caller's by construction.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export const PERSONAL_FEATURES = [
  "evaluations",
  "datasets",
  "annotations",
  "automations",
] as const;
export type PersonalFeature = (typeof PERSONAL_FEATURES)[number];

export type PersonalFeaturesShape = Record<PersonalFeature, boolean>;

const ALL_FALSE: PersonalFeaturesShape = {
  evaluations: false,
  datasets: false,
  annotations: false,
  automations: false,
};

const ALL_TRUE: PersonalFeaturesShape = {
  evaluations: true,
  datasets: true,
  annotations: true,
  automations: true,
};

/**
 * Pure helper. Reads any of the four flags from a stored JSON value,
 * defaulting missing keys to `false`. Use this everywhere — never
 * touch the JSON column directly. Pre-migration rows return all-false.
 */
export function personalFeatureEnabled(
  stored: unknown,
  feature: PersonalFeature,
): boolean {
  if (!stored || typeof stored !== "object") return false;
  const v = (stored as Record<string, unknown>)[feature];
  return v === true;
}

/**
 * Materialises the canonical 4-key shape from the JSON column. Same
 * `false` default rule as `personalFeatureEnabled`.
 */
export function readPersonalFeatures(stored: unknown): PersonalFeaturesShape {
  return {
    evaluations: personalFeatureEnabled(stored, "evaluations"),
    datasets: personalFeatureEnabled(stored, "datasets"),
    annotations: personalFeatureEnabled(stored, "annotations"),
    automations: personalFeatureEnabled(stored, "automations"),
  };
}

export class PersonalProjectNotFoundError extends Error {
  readonly code = "personal_project_not_found" as const;
  constructor(projectId: string) {
    super(`Personal project ${projectId} not found`);
    this.name = "PersonalProjectNotFoundError";
  }
}

export class PersonalProjectOwnerMismatchError extends Error {
  readonly code = "personal_project_owner_mismatch" as const;
  constructor() {
    // Collapsed message — we never tell the caller which user owns
    // the project (would be an enumeration vector). Same shape as
    // RoutingPolicyService.requireOwn.
    super("Personal project not found");
    this.name = "PersonalProjectOwnerMismatchError";
  }
}

export class PersonalWorkspaceFeaturesService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): PersonalWorkspaceFeaturesService {
    return new PersonalWorkspaceFeaturesService(prisma);
  }

  async get({
    projectId,
    callerUserId,
  }: {
    projectId: string;
    callerUserId: string;
  }): Promise<PersonalFeaturesShape> {
    const project = await this.requireOwnedPersonalProject(
      projectId,
      callerUserId,
    );
    return readPersonalFeatures(project.personalFeatures);
  }

  async enableAll({
    projectId,
    callerUserId,
  }: {
    projectId: string;
    callerUserId: string;
  }): Promise<PersonalFeaturesShape> {
    return await this.setBundle({
      projectId,
      callerUserId,
      next: ALL_TRUE,
      action: "personalWorkspaceFeatures.enableAll",
    });
  }

  async disableAll({
    projectId,
    callerUserId,
  }: {
    projectId: string;
    callerUserId: string;
  }): Promise<PersonalFeaturesShape> {
    return await this.setBundle({
      projectId,
      callerUserId,
      next: ALL_FALSE,
      action: "personalWorkspaceFeatures.disableAll",
    });
  }

  private async setBundle({
    projectId,
    callerUserId,
    next,
    action,
  }: {
    projectId: string;
    callerUserId: string;
    next: PersonalFeaturesShape;
    action: string;
  }): Promise<PersonalFeaturesShape> {
    const existing = await this.requireOwnedPersonalProject(
      projectId,
      callerUserId,
    );
    const previousState = readPersonalFeatures(existing.personalFeatures);

    return await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { personalFeatures: next as unknown as Prisma.InputJsonValue },
      });
      // Audit-log row visible to org admins via the existing audit
      // RBAC AND to the user themselves on `/me/configure → Activity`.
      // Forensic shape: previousState + newState as JSON metadata.
      await tx.auditLog.create({
        data: {
          userId: callerUserId,
          projectId,
          organizationId: existing.team?.organizationId ?? null,
          action,
          targetKind: "project",
          targetId: projectId,
          before: previousState as unknown as Prisma.InputJsonValue,
          after: next as unknown as Prisma.InputJsonValue,
        },
      });
      return next;
    });
  }

  private async requireOwnedPersonalProject(
    projectId: string,
    callerUserId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        isPersonal: true,
        ownerUserId: true,
        personalFeatures: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project) {
      throw new PersonalProjectNotFoundError(projectId);
    }
    // Collapse "not personal" + "wrong owner" into the same response
    // shape so the caller can't enumerate other users' personal
    // projects by probing project ids.
    if (!project.isPersonal || project.ownerUserId !== callerUserId) {
      throw new PersonalProjectOwnerMismatchError();
    }
    return project;
  }
}
