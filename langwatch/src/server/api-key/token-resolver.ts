import type { PrismaClient, Project } from "@prisma/client";
import { RoleBindingScopeType } from "@prisma/client";

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
      /**
       * Set when the resolved ApiKey is an ingestion key (a project-scoped,
       * ingest-only credential). Carries the tool slug the receiver stamps
       * as `langwatch.source` provenance; null for ordinary API keys.
       */
      ingestSourceType: string | null;
      /** The template this ingestion key was minted for, if any. */
      ingestionTemplateId: string | null;
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
 *   - pat-lw-* → API key lookup (old PAT format, backward compat)
 *   - sk-lw-{id}_{secret} → API key lookup (new format; ingestion keys
 *     are ordinary API keys carrying ingestSourceType)
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
   * X-Project-Id header, or URL). Ingestion keys are ordinary API keys —
   * the caller still supplies the project, and the key carries the
   * ingestSourceType the receiver stamps as provenance.
   */
  async resolve({
    token,
    projectId,
  }: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedToken | null> {
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

    // Single-project self-scoping: when the caller supplies no projectId — an
    // OTLP exporter that sends only the bearer token, or any client that can't
    // attach an X-Project-Id header — a key scoped to exactly ONE project is
    // unambiguous, so we resolve to that project. Keys scoped to two or more
    // projects (or only at org / team scope) stay ambiguous and still require
    // an explicit projectId. Ingestion keys are the common case (a single
    // PROJECT-scoped binding), but this holds for any single-project API key.
    let effectiveProjectId = projectId;
    if (!effectiveProjectId) {
      const projectScopeIds = [
        ...new Set(
          apiKey.roleBindings
            .filter(
              (b) => b.scopeType === RoleBindingScopeType.PROJECT && b.scopeId,
            )
            .map((b) => b.scopeId),
        ),
      ];
      if (projectScopeIds.length === 1) {
        effectiveProjectId = projectScopeIds[0]!;
      }
    }

    if (!effectiveProjectId) return null;

    // Look up the project and verify it belongs to the API key's organization
    const project = await this.prisma.project.findUnique({
      where: { id: effectiveProjectId, archivedAt: null },
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
      ingestSourceType: apiKey.ingestSourceType,
      ingestionTemplateId: apiKey.ingestionTemplateId,
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
}
