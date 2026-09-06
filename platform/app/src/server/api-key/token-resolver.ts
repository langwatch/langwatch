import type { PrismaClient, Project } from "~/generated/prisma/client";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import { ApiKeyService } from "./api-key.service";
import { API_KEY_PREFIX, getTokenType } from "./api-key-token.utils";
import { LANGY_SESSION_API_KEY_NAME } from "./reserved-names";

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
      /**
       * Set when the resolved ApiKey is the ephemeral key a Langy chat mints
       * for itself. The permission ceiling reads it to tell two refusals
       * apart: a permission the caller could hold, and one the platform never
       * delegates to Langy however the key or the role is widened. Absent
       * means an ordinary key, so a caller that never sets it keeps the
       * generic refusal.
       */
      isLangySessionKey?: boolean;
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
 * The outcome of org-level resolution, with the two failures kept apart.
 *
 * `wrong_credential_class` is a working credential of the other family: the
 * caller has to swap the key, and telling them to check it for typos wastes
 * their afternoon. `unusable_credential` is everything else, and stays
 * deliberately vague, since distinguishing "no such key" from "revoked key"
 * for an unauthenticated caller would confirm which secrets exist.
 */
export type OrgResolution =
  | { ok: true; resolved: OrgResolvedToken }
  | { ok: false; reason: "wrong_credential_class" | "unusable_credential" };

/**
 * Strategy-based token resolver. Routes tokens to the correct verification
 * path based on prefix and structure:
 *   - pat-lw-* → API key lookup (old PAT format, backward compat)
 *   - sk-lw-{id}_{secret} → API key lookup (new format; ingestion keys
 *     are ordinary API keys carrying ingestSourceType), with a legacy
 *     project key fallback for look-alike legacy keys
 *   - any other sk-lw-* → legacy project key lookup
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
      case "apiKey": {
        const resolved = await this.resolveApiKey(token, projectId ?? null);
        // A legacy project key can be shaped exactly like a new API key
        // (its random body may contain an underscore), so when API key
        // resolution misses for an sk-lw- token, fall back to the legacy
        // lookup. The fallback only grants access when the full token
        // matches a stored project key, so misses stay a 401.
        if (!resolved && token.startsWith(API_KEY_PREFIX)) {
          return this.resolveLegacyProjectKey(token);
        }
        return resolved;
      }
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
      isLangySessionKey: apiKey.name === LANGY_SESSION_API_KEY_NAME,
      project,
    };
  }

  /**
   * Resolves an API key to organization-level context without requiring a
   * project.
   *
   * On failure it says WHICH failure, because the three are far apart in what
   * the caller should do next and used to be told apart by nothing: a typo, a
   * revoked key, and a perfectly good project key sent to a route only an
   * organization key reaches all produced the same sentence asserting the
   * last of the three. `wrong_credential_class` is returned only when the
   * token really does resolve as a project key, so the answer is never a
   * guess about a credential we could not read.
   */
  async resolveOrgOnly({ token }: { token: string }): Promise<OrgResolution> {
    if (getTokenType(token) === "apiKey") {
      const apiKey = await this.apiKeyService.verify({ token });
      if (apiKey) {
        return {
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: apiKey.id,
            userId: apiKey.userId,
            organizationId: apiKey.organizationId,
          },
        };
      }
    }

    // A legacy project key can be shaped exactly like an API key, so the
    // shape alone never decides this; only a hit on the stored key does.
    const legacy = await this.resolveLegacyProjectKey(token);
    return legacy
      ? { ok: false, reason: "wrong_credential_class" }
      : { ok: false, reason: "unusable_credential" };
  }

  /**
   * Marks an API key as used. Callers should invoke this only after the request
   * is fully validated so lastUsedAt reflects successful authenticated use.
   */
  markUsed({ apiKeyId }: { apiKeyId: string }): void {
    this.apiKeyService.markUsed({ id: apiKeyId });
  }
}
