import type { PrismaClient, Project } from "@prisma/client";

import {
  BINDING_TOKEN_PREFIX,
  hashBindingTokenBody,
  parseBindingToken,
} from "@ee/governance/services/userIngestionBindingToken.utils";

import { getTokenType } from "./pat-token.utils";
import { PatService } from "./pat.service";

/**
 * The result of resolving a token. Contains enough context to set up the
 * request for downstream route handlers.
 */
export type ResolvedToken =
  | {
      type: "legacy";
      project: Project & { team: { id: string; organizationId: string } };
    }
  | {
      type: "pat";
      patId: string;
      userId: string;
      organizationId: string;
      project: Project & { team: { id: string; organizationId: string } };
    }
  | {
      type: "user_ingestion_binding";
      bindingId: string;
      templateId: string;
      /** Template slug (e.g. `claude_code`) — receiver stamps this as
       *  `langwatch.source` provenance attr on every span. */
      templateSlug: string;
      userId: string;
      organizationId: string;
      project: Project & { team: { id: string; organizationId: string } };
    };

/**
 * Strategy-based token resolver. Routes tokens to the correct verification
 * path based on prefix:
 *   - sk-lw-* → legacy project API key lookup (unchanged)
 *   - pat-lw-* → PAT lookup + project resolution
 *   - lwub_*  → UserIngestionBinding hash lookup → personal project
 */
export class TokenResolver {
  private readonly patService: PatService;

  constructor(private readonly prisma: PrismaClient) {
    this.patService = PatService.create(prisma);
  }

  static create(prisma: PrismaClient): TokenResolver {
    return new TokenResolver(prisma);
  }

  /**
   * Resolves a token to a project context.
   *
   * For legacy keys, projectId is implicit (from the key itself).
   * For PATs, projectId must be provided separately (from Basic Auth,
   * X-Project-Id header, or URL).
   * For UserIngestionBinding tokens, projectId is implicit (the binding
   * row carries personalProjectId server-resolved at install time).
   */
  async resolve({
    token,
    projectId,
  }: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedToken | null> {
    if (token.startsWith(BINDING_TOKEN_PREFIX)) {
      return this.resolveUserIngestionBinding(token);
    }

    const tokenType = getTokenType(token);

    switch (tokenType) {
      case "legacy":
        return this.resolveLegacy(token);
      case "pat":
        return this.resolvePat(token, projectId ?? null);
      default:
        // Unknown prefix — try legacy lookup as fallback
        return this.resolveLegacy(token);
    }
  }

  private async resolveLegacy(
    apiKey: string,
  ): Promise<ResolvedToken | null> {
    const project = await this.prisma.project.findUnique({
      where: { apiKey, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    return { type: "legacy", project };
  }

  private async resolvePat(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedToken | null> {
    const pat = await this.patService.verify({ token });
    if (!pat) return null;

    if (!projectId) return null;

    // Look up the project and verify it belongs to the PAT's organization
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    // Verify the project belongs to the same organization as the PAT
    if (project.team.organizationId !== pat.organizationId) return null;

    return {
      type: "pat",
      patId: pat.id,
      userId: pat.userId,
      organizationId: pat.organizationId,
      project,
    };
  }

  /**
   * Marks a PAT as used. Callers should invoke this only after the request
   * is fully validated (body parsed, params accepted) so lastUsedAt reflects
   * successful authenticated use, not merely successful authentication.
   */
  markUsed({ patId }: { patId: string }): void {
    this.patService.markUsed({ id: patId });
  }

  /**
   * Resolves a `lwub_<base32>` UserIngestionBinding token. Path:
   *   1. Strip prefix, hash post-prefix body with SHA-256.
   *   2. Indexed lookup against `bindingAccessTokenHash`.
   *   3. Defense-in-depth re-verify: project still personal, owner
   *      still matches binding userId, binding enabled, neither row
   *      archived. Mismatches return null (no enumeration vector).
   *
   * The personalProjectId on the binding row is server-resolved at
   * install time — by the time we read it here, it is the authoritative
   * scope. Cross-bind structural-impossibility is enforced at install,
   * not here.
   */
  private async resolveUserIngestionBinding(
    token: string,
  ): Promise<ResolvedToken | null> {
    const parsed = parseBindingToken(token);
    if (!parsed) return null;
    const hash = hashBindingTokenBody(parsed.body);

    const binding = await this.prisma.userIngestionBinding.findUnique({
      where: { bindingAccessTokenHash: hash },
      select: {
        id: true,
        userId: true,
        templateId: true,
        organizationId: true,
        enabled: true,
        archivedAt: true,
        template: { select: { slug: true } },
        personalProject: {
          include: {
            team: { select: { id: true, organizationId: true } },
          },
        },
      },
    });
    if (!binding) return null;
    if (binding.archivedAt || !binding.enabled) return null;
    if (
      !binding.personalProject ||
      binding.personalProject.archivedAt ||
      !binding.personalProject.isPersonal ||
      binding.personalProject.ownerUserId !== binding.userId
    ) {
      return null;
    }

    return {
      type: "user_ingestion_binding",
      bindingId: binding.id,
      templateId: binding.templateId,
      templateSlug: binding.template.slug,
      userId: binding.userId,
      organizationId: binding.organizationId,
      project: binding.personalProject,
    };
  }
}
