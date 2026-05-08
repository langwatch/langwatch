// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * UserIngestionBindingService — owns install / list / uninstall / rotate
 * for the personal-project trace-ingest binding model.
 *
 * Cross-bind guard is service-layer (structural-impossibility): the
 * service input shape MUST NOT accept `personalProjectId` from the
 * caller. Server resolves at install via the User → personal Team →
 * personal Project ladder, asserting `Project.isPersonal === true` and
 * `Project.team.ownerUserId === callerUserId`. A caller cannot bind to
 * another user's project even with a valid templateId because the
 * binding is constructed against the caller's resolved project.
 *
 * Hard-cut rotation v1: rotate replaces `bindingAccessTokenHash` and
 * `bindingAccessTokenPrefix` in-place. No previous-hash, no grace
 * window, no `deprecated_token_used` audit row.
 *
 * Spec:
 *   specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 *   specs/ai-gateway/governance/template-cross-bind-guard.feature
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  BINDING_TOKEN_PREFIX_DISPLAY_LENGTH,
  issueBindingToken,
} from "./userIngestionBindingToken.utils";

export class PersonalProjectMissingError extends Error {
  readonly code = "personal_project_missing" as const;
  constructor() {
    super(
      "Personal project not found for caller. Sign in to a personal workspace before installing an ingestion template.",
    );
    this.name = "PersonalProjectMissingError";
  }
}

export class IngestionTemplateNotFoundError extends Error {
  readonly code = "ingestion_template_not_found" as const;
  constructor() {
    // Collapsed message — never tell the caller whether the template
    // exists in another org. Same enumeration-vector defense as
    // PersonalProjectOwnerMismatchError.
    super("Ingestion template not found");
    this.name = "IngestionTemplateNotFoundError";
  }
}

export class BindingNotFoundError extends Error {
  readonly code = "binding_not_found" as const;
  constructor() {
    super("Binding not found");
    this.name = "BindingNotFoundError";
  }
}

export class BindingAlreadyExistsError extends Error {
  readonly code = "binding_already_exists" as const;
  constructor() {
    super(
      "A binding already exists for this template. Uninstall it first or rotate the token.",
    );
    this.name = "BindingAlreadyExistsError";
  }
}

export interface BindingRow {
  id: string;
  userId: string;
  templateId: string;
  personalProjectId: string;
  organizationId: string;
  bindingAccessTokenPrefix: string;
  enabled: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstallBindingResult {
  binding: BindingRow;
  /** Plaintext token, shown ONCE to the user. Never re-fetchable. */
  token: string;
}

export class UserIngestionBindingService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): UserIngestionBindingService {
    return new UserIngestionBindingService(prisma);
  }

  /**
   * Install a binding for `(callerUserId, templateId)` in the caller's
   * personal project. The personalProjectId is server-resolved — the
   * input shape DOES NOT and MUST NOT carry it.
   *
   * `encryptedCredential` is captured opaque-blob style for templates
   * whose credentialSchema is `static_api_key` or `agent_id`. v1 ships
   * only otlp_token templates; the column stays null in practice but
   * the path is wired so v2 templates don't need a service refactor.
   */
  async install({
    callerUserId,
    templateId,
    encryptedCredential,
  }: {
    callerUserId: string;
    templateId: string;
    encryptedCredential?: Prisma.InputJsonValue;
  }): Promise<InstallBindingResult> {
    const project = await this.requireOwnedPersonalProject(callerUserId);
    const template = await this.requireVisibleTemplate({
      templateId,
      organizationId: project.organizationId,
    });

    const existing = await this.prisma.userIngestionBinding.findUnique({
      where: {
        userId_templateId: {
          userId: callerUserId,
          templateId: template.id,
        },
      },
      select: { id: true, archivedAt: true },
    });
    if (existing && !existing.archivedAt) {
      throw new BindingAlreadyExistsError();
    }

    const issued = issueBindingToken();

    const binding = await this.prisma.$transaction(async (tx) => {
      // If a soft-archived row exists, revive it with new token + clear
      // archivedAt rather than violating the (userId, templateId) UNIQUE.
      const upserted = existing
        ? await tx.userIngestionBinding.update({
            where: { id: existing.id },
            data: {
              personalProjectId: project.id,
              organizationId: project.organizationId,
              bindingAccessTokenHash: issued.hash,
              bindingAccessTokenPrefix: issued.prefix,
              encryptedCredential: encryptedCredential ?? Prisma.DbNull,
              enabled: true,
              archivedAt: null,
              lastSeenAt: null,
            },
          })
        : await tx.userIngestionBinding.create({
            data: {
              userId: callerUserId,
              templateId: template.id,
              personalProjectId: project.id,
              organizationId: project.organizationId,
              bindingAccessTokenHash: issued.hash,
              bindingAccessTokenPrefix: issued.prefix,
              encryptedCredential: encryptedCredential ?? Prisma.DbNull,
            },
          });

      await tx.auditLog.create({
        data: {
          userId: callerUserId,
          projectId: project.id,
          organizationId: project.organizationId,
          action: "gateway.user_ingestion_binding.installed",
          targetKind: "user_ingestion_binding",
          targetId: upserted.id,
          metadata: {
            templateId: template.id,
            templateSlug: template.slug,
          },
        },
      });

      return upserted;
    });

    return { binding: toRow(binding), token: issued.token };
  }

  /** Caller's own bindings, archived or not. Caller user-scope only. */
  async listForCaller({
    callerUserId,
  }: {
    callerUserId: string;
  }): Promise<BindingRow[]> {
    const rows = await this.prisma.userIngestionBinding.findMany({
      where: { userId: callerUserId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRow);
  }

  async uninstall({
    callerUserId,
    bindingId,
  }: {
    callerUserId: string;
    bindingId: string;
  }): Promise<void> {
    const binding = await this.prisma.userIngestionBinding.findFirst({
      where: { id: bindingId, userId: callerUserId, archivedAt: null },
      select: {
        id: true,
        templateId: true,
        organizationId: true,
        personalProjectId: true,
      },
    });
    if (!binding) throw new BindingNotFoundError();

    await this.prisma.$transaction(async (tx) => {
      await tx.userIngestionBinding.update({
        where: { id: binding.id },
        data: { archivedAt: new Date(), enabled: false },
      });
      await tx.auditLog.create({
        data: {
          userId: callerUserId,
          projectId: binding.personalProjectId,
          organizationId: binding.organizationId,
          action: "gateway.user_ingestion_binding.uninstalled",
          targetKind: "user_ingestion_binding",
          targetId: binding.id,
          metadata: { templateId: binding.templateId },
        },
      });
    });
  }

  /**
   * Rotate the binding token. Hard-cut v1: the previous token is
   * invalidated immediately; the receiver returns 401 on the next use.
   * Returns the new plaintext token (shown ONCE).
   */
  async rotateToken({
    callerUserId,
    bindingId,
  }: {
    callerUserId: string;
    bindingId: string;
  }): Promise<{ binding: BindingRow; token: string }> {
    const binding = await this.prisma.userIngestionBinding.findFirst({
      where: { id: bindingId, userId: callerUserId, archivedAt: null },
    });
    if (!binding) throw new BindingNotFoundError();

    const issued = issueBindingToken();

    const updated = await this.prisma.userIngestionBinding.update({
      where: { id: binding.id },
      data: {
        bindingAccessTokenHash: issued.hash,
        bindingAccessTokenPrefix: issued.prefix,
      },
    });

    return { binding: toRow(updated), token: issued.token };
  }

  /**
   * Defense-in-depth lookup used by the receiver auth path AFTER a
   * candidate hash has matched the indexed column. Re-verifies the
   * binding is still owned by a personal project owned by the binding's
   * `userId`, the project hasn't flipped non-personal, and the binding
   * is enabled + non-archived.
   */
  async resolveByHashForReceive({
    bindingAccessTokenHash,
  }: {
    bindingAccessTokenHash: string;
  }): Promise<{
    bindingId: string;
    userId: string;
    templateId: string;
    personalProjectId: string;
    organizationId: string;
  } | null> {
    const binding = await this.prisma.userIngestionBinding.findUnique({
      where: { bindingAccessTokenHash },
      select: {
        id: true,
        userId: true,
        templateId: true,
        personalProjectId: true,
        organizationId: true,
        enabled: true,
        archivedAt: true,
        personalProject: {
          select: { isPersonal: true, ownerUserId: true, archivedAt: true },
        },
      },
    });
    if (!binding) return null;
    if (binding.archivedAt) return null;
    if (!binding.enabled) return null;
    if (
      !binding.personalProject ||
      binding.personalProject.archivedAt ||
      !binding.personalProject.isPersonal ||
      binding.personalProject.ownerUserId !== binding.userId
    ) {
      return null;
    }
    return {
      bindingId: binding.id,
      userId: binding.userId,
      templateId: binding.templateId,
      personalProjectId: binding.personalProjectId,
      organizationId: binding.organizationId,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Server-resolves the caller's personal project. Throws on missing —
   * never returns another user's project even if the input were
   * tampered (which it can't be, since the input shape doesn't accept
   * personalProjectId at all).
   */
  private async requireOwnedPersonalProject(callerUserId: string): Promise<{
    id: string;
    organizationId: string;
  }> {
    const team = await this.prisma.team.findFirst({
      where: {
        ownerUserId: callerUserId,
        isPersonal: true,
        archivedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        projects: {
          where: { isPersonal: true, archivedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!team || team.projects.length === 0) {
      throw new PersonalProjectMissingError();
    }
    return {
      id: team.projects[0]!.id,
      organizationId: team.organizationId,
    };
  }

  /**
   * Resolves a template visible to the caller's organization (platform-
   * published OR org-authored on the same org). Cross-org probes collapse
   * to `IngestionTemplateNotFoundError`.
   */
  private async requireVisibleTemplate({
    templateId,
    organizationId,
  }: {
    templateId: string;
    organizationId: string;
  }): Promise<{ id: string; slug: string }> {
    const template = await this.prisma.ingestionTemplate.findFirst({
      where: {
        id: templateId,
        archivedAt: null,
        enabled: true,
        OR: [
          { organizationId: null },
          { organizationId },
        ],
      },
      select: { id: true, slug: true },
    });
    if (!template) throw new IngestionTemplateNotFoundError();
    return template;
  }
}

function toRow(b: {
  id: string;
  userId: string;
  templateId: string;
  personalProjectId: string;
  organizationId: string;
  bindingAccessTokenPrefix: string;
  enabled: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BindingRow {
  return {
    id: b.id,
    userId: b.userId,
    templateId: b.templateId,
    personalProjectId: b.personalProjectId,
    organizationId: b.organizationId,
    bindingAccessTokenPrefix: b.bindingAccessTokenPrefix,
    enabled: b.enabled,
    lastSeenAt: b.lastSeenAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

void BINDING_TOKEN_PREFIX_DISPLAY_LENGTH;
