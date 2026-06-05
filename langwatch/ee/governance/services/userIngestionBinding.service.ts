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

import { GovernanceAuditRepository } from "../repositories/governanceAudit.repository";
import { IngestionTemplateRepository } from "../repositories/ingestionTemplate.repository";
import { UserIngestionBindingRepository } from "../repositories/userIngestionBinding.repository";
import { encryptCredential } from "./activity-monitor/ingestionCredentials";
import {
  DEFAULT_GOVERNANCE_SURFACE,
  type GovernanceCallSurface,
} from "./auditSurface";
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
  /** Null for template-free coding-assistant bindings. */
  templateId: string | null;
  /** Canonical tool slug; always set (install identity with personalProjectId). */
  sourceType: string;
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bindingRepo: UserIngestionBindingRepository = new UserIngestionBindingRepository(),
    private readonly templateRepo: IngestionTemplateRepository = new IngestionTemplateRepository(),
    private readonly auditRepo: GovernanceAuditRepository = new GovernanceAuditRepository(),
  ) {}

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
    organizationId,
    templateId,
    sourceType: sourceTypeInput,
    encryptedCredential,
    surface,
  }: {
    callerUserId: string;
    /** The caller's currently-active organization. A user can have a
     *  personal project per org they're a member of; the install lands
     *  in the personal project for THIS org. The cross-bind invariant
     *  is preserved: Project.ownerUserId === callerUserId is asserted
     *  inside requireOwnedPersonalProject. */
    organizationId: string;
    /** Template-backed install (e.g. claude_cowork). Mutually exclusive
     *  with `sourceType`: the binding mirrors the template's sourceType. */
    templateId?: string;
    /** Template-free install for the unified coding assistants
     *  (claude / codex / gemini / opencode). The CLI passes the tool's
     *  canonical source slug; no IngestionTemplate row is required. */
    sourceType?: string;
    encryptedCredential?: Prisma.InputJsonValue;
    /** Audit-trail attribution per umbrella spec @audit-uniform. */
    surface?: GovernanceCallSurface;
  }): Promise<InstallBindingResult> {
    if (!templateId && !sourceTypeInput) {
      throw new Error("install requires either templateId or sourceType");
    }

    const project = await this.requireOwnedPersonalProject({
      callerUserId,
      organizationId,
    });

    // Template-backed installs mirror the template's sourceType;
    // template-free CLI installs carry the slug the wrapper passed.
    const template = templateId
      ? await this.requireVisibleTemplate({
          templateId,
          organizationId: project.organizationId,
        })
      : null;
    const sourceType = template?.sourceType ?? sourceTypeInput;
    if (!sourceType) {
      throw new Error("install could not resolve a sourceType");
    }

    const issued = issueBindingToken();

    // The credential blob carries a live upstream secret; never persist it
    // as plaintext. Encrypt to a tagged string (the column stays Json).
    const storedCredential: Prisma.InputJsonValue | typeof Prisma.DbNull =
      encryptedCredential === undefined || encryptedCredential === null
        ? Prisma.DbNull
        : encryptCredential(encryptedCredential);

    const binding = await this.prisma.$transaction(async (tx) => {
      // Race-safe upsert keyed on the (personalProjectId, sourceType)
      // UNIQUE. update = rotate the token in place (and revive a
      // soft-archived row, clearing archivedAt); create = mint fresh.
      // Two concurrent installs can't both create — the loser hits the
      // unique and falls into update. Keying per personal project scopes
      // the binding to one (user, org), so multi-org never collides.
      const upserted = await this.bindingRepo.upsertByProjectAndSource(tx, {
        personalProjectId: project.id,
        sourceType,
        create: {
          userId: callerUserId,
          templateId: template?.id ?? null,
          sourceType,
          personalProjectId: project.id,
          organizationId: project.organizationId,
          bindingAccessTokenHash: issued.hash,
          bindingAccessTokenPrefix: issued.prefix,
          encryptedCredential: storedCredential,
        },
        update: {
          // (personalProjectId, sourceType) is the upsert key — never
          // moved. Rotate the token + revive if archived.
          templateId: template?.id ?? null,
          organizationId: project.organizationId,
          bindingAccessTokenHash: issued.hash,
          bindingAccessTokenPrefix: issued.prefix,
          encryptedCredential: storedCredential,
          enabled: true,
          archivedAt: null,
          lastSeenAt: null,
        },
      });

      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        projectId: project.id,
        organizationId: project.organizationId,
        action: "gateway.user_ingestion_binding.installed",
        targetKind: "user_ingestion_binding",
        targetId: upserted.id,
        metadata: {
          templateId: template?.id ?? null,
          templateSlug: template?.slug ?? null,
          sourceType,
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
        },
      });

      return upserted;
    });

    return { binding: toRow(binding), token: issued.token };
  }

  /** Caller's own bindings within `organizationId`. */
  async listForCaller({
    callerUserId,
    organizationId,
  }: {
    callerUserId: string;
    organizationId: string;
  }): Promise<BindingRow[]> {
    const rows = await this.bindingRepo.findManyForCallerInOrg(this.prisma, {
      userId: callerUserId,
      organizationId,
    });
    return rows.map(toRow);
  }

  async uninstall({
    callerUserId,
    organizationId,
    bindingId,
    surface,
  }: {
    callerUserId: string;
    organizationId: string;
    bindingId: string;
    surface?: GovernanceCallSurface;
  }): Promise<void> {
    const binding = await this.bindingRepo.findOwnedNonArchived(this.prisma, {
      bindingId,
      userId: callerUserId,
      organizationId,
      select: {
        id: true,
        templateId: true,
        organizationId: true,
        personalProjectId: true,
      },
    });
    if (!binding) throw new BindingNotFoundError();

    await this.prisma.$transaction(async (tx) => {
      await this.bindingRepo.updateById(tx, {
        id: binding.id,
        data: { archivedAt: new Date(), enabled: false },
      });
      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        projectId: binding.personalProjectId,
        organizationId: binding.organizationId,
        action: "gateway.user_ingestion_binding.uninstalled",
        targetKind: "user_ingestion_binding",
        targetId: binding.id,
        metadata: {
          templateId: binding.templateId,
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
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
    organizationId,
    bindingId,
    surface,
  }: {
    callerUserId: string;
    organizationId: string;
    bindingId: string;
    surface?: GovernanceCallSurface;
  }): Promise<{ binding: BindingRow; token: string }> {
    const binding = await this.bindingRepo.findOwnedNonArchived(this.prisma, {
      bindingId,
      userId: callerUserId,
      organizationId,
    });
    if (!binding) throw new BindingNotFoundError();

    const issued = issueBindingToken();

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await this.bindingRepo.updateById(tx, {
        id: binding.id,
        data: {
          bindingAccessTokenHash: issued.hash,
          bindingAccessTokenPrefix: issued.prefix,
        },
      });
      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        projectId: binding.personalProjectId,
        organizationId: binding.organizationId,
        action: "gateway.user_ingestion_binding.token_rotated",
        targetKind: "user_ingestion_binding",
        targetId: binding.id,
        metadata: {
          templateId: binding.templateId,
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
        },
      });
      return u;
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
    /** Null for template-free coding-assistant bindings. */
    templateId: string | null;
    /** Canonical tool slug — always set; the stable provenance source. */
    sourceType: string;
    personalProjectId: string;
    organizationId: string;
  } | null> {
    const binding = await this.bindingRepo.findUniqueByHashForReceive(
      this.prisma,
      { bindingAccessTokenHash },
    );
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
      sourceType: binding.sourceType,
      personalProjectId: binding.personalProjectId,
      organizationId: binding.organizationId,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Server-resolves the caller's personal project within
   * `organizationId`. Throws on missing — never returns another user's
   * project even if the input were tampered.
   *
   * Implementation note: queries Project directly (Project is exempt
   * from both `dbMultiTenancyProtection` and `dbOrganizationIdProtection`)
   * keyed on `ownerUserId` + `isPersonal` + the team's `organizationId`.
   * A user may have multiple personal projects across orgs; the caller
   * passes their currently-active organizationId so the lookup is
   * deterministic.
   *
   * Caught in real-user dogfood when Ariana clicked the Connect tile —
   * the original Team-keyed lookup tripped the dbOrganizationIdProtection
   * guard (Team is in PROTECTED_MODELS) and rejected the install.
   */
  private async requireOwnedPersonalProject({
    callerUserId,
    organizationId,
  }: {
    callerUserId: string;
    organizationId: string;
  }): Promise<{
    id: string;
    organizationId: string;
  }> {
    const project = await this.bindingRepo.findOwnedPersonalProjectInOrg(
      this.prisma,
      { callerUserId, organizationId },
    );
    if (!project || !project.team) {
      throw new PersonalProjectMissingError();
    }
    return {
      id: project.id,
      organizationId: project.team.organizationId,
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
  }): Promise<{ id: string; slug: string; sourceType: string }> {
    // Cross-bind safety: the user-side surface only sees platform
    // defaults OR org-authored rows for THIS org. Cross-org probes
    // collapse to NotFound. Routed through the IngestionTemplate
    // repository so all `prisma.ingestionTemplate.*` queries live in
    // a single layer per umbrella spec @repository-pattern.
    const template = await this.templateRepo.findByIdForOrg(this.prisma, {
      id: templateId,
      organizationId,
    });
    if (!template || !template.enabled) {
      throw new IngestionTemplateNotFoundError();
    }
    return {
      id: template.id,
      slug: template.slug,
      sourceType: template.sourceType,
    };
  }
}

function toRow(b: {
  id: string;
  userId: string;
  templateId: string | null;
  sourceType: string;
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
    sourceType: b.sourceType,
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
