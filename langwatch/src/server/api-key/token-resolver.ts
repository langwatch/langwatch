import type { PrismaClient, Project } from "@prisma/client";

import {
  BINDING_TOKEN_PREFIX,
  hashBindingTokenBody,
  parseBindingToken,
} from "@ee/governance/services/userIngestionBindingToken.utils";

import { getTokenType } from "./api-key-token.utils";
import { ApiKeyService } from "./api-key.service";

/**
 * The result of resolving a token. Contains enough context to set up the
 * request for downstream route handlers.
 */
export type ResolvedToken =
  | {
      type: "legacyProjectKey";
      project: Project & { team: { id: string; organizationId: string } };
    }
  | {
      type: "apiKey";
      apiKeyId: string;
      userId: string | null;
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
 * Org-level API key resolution — no project context required.
 * Used by endpoints that operate at the organization level (e.g. project creation).
 */
export type OrgResolvedToken = {
  type: "apiKey-org";
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
};

/**
 * Strategy-based token resolver. Routes tokens to the correct verification
 * path based on prefix and structure:
 *   - ik-lw-*  → UserIngestionBinding hash lookup → personal project
 *   - pat-lw-* → API key lookup (old PAT format, backward compat)
 *   - sk-lw-{id}_{secret} → API key lookup (new format)
 *   - sk-lw-* (no underscore) → legacy project key lookup
 */
export class TokenResolver {
  private readonly apiKeyService: ApiKeyService;

  constructor(private readonly prisma: PrismaClient) {
    this.apiKeyService = ApiKeyService.create(prisma);
  }

  static create(prisma: PrismaClient): TokenResolver {
    return new TokenResolver(prisma);
  }

  /**
   * Resolves a token to a project context.
   *
   * For legacy project keys, projectId is implicit (from the key itself).
   * For API keys, projectId must be provided separately (from Basic Auth,
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
      case "legacyProjectKey":
        return this.resolveLegacyProjectKey(token);
      case "apiKey":
        return this.resolveApiKey(token, projectId ?? null);
      default:
        // Unknown prefix — try legacy lookup as fallback
        return this.resolveLegacyProjectKey(token);
    }
  }

  private async resolveLegacyProjectKey(
    apiKey: string,
  ): Promise<ResolvedToken | null> {
    const project = await this.prisma.project.findUnique({
      where: { apiKey, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    return { type: "legacyProjectKey", project };
  }

  private async resolveApiKey(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedToken | null> {
    const apiKey = await this.apiKeyService.verify({ token });
    if (!apiKey) return null;

    if (!projectId) return null;

    // Look up the project and verify it belongs to the API key's organization
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    // Verify the project belongs to the same organization as the API key
    if (project.team.organizationId !== apiKey.organizationId) return null;

    return {
      type: "apiKey",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      project,
    };
  }

  /**
   * Resolves an API key to organization-level context without requiring a project.
   * Returns null when the token is invalid or not an API key.
   */
  async resolveOrgOnly({
    token,
  }: {
    token: string;
  }): Promise<OrgResolvedToken | null> {
    const tokenType = getTokenType(token);
    if (tokenType !== "apiKey") return null;

    const apiKey = await this.apiKeyService.verify({ token });
    if (!apiKey) return null;

    return {
      type: "apiKey-org",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
    };
  }

  /**
   * Marks an API key as used. Callers should invoke this only after the request
   * is fully validated so lastUsedAt reflects successful authenticated use.
   */
  markUsed({ apiKeyId }: { apiKeyId: string }): void {
    this.apiKeyService.markUsed({ id: apiKeyId });
  }

  /**
   * Resolves a `ik-lw-<base32>` UserIngestionBinding token. Path:
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
