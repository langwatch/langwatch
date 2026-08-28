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
 * The outcome of project-level resolution, with the three failures kept
 * apart for the same reason {@link OrgResolution} keeps its two apart: they
 * are far apart in what the caller does next.
 *
 * `project_not_covered` is a working key that named a project none of its
 * bindings reach — the caller widens the key or names a project it holds.
 * `project_ambiguous` is a working key that named nothing and covers more
 * than one project (or none directly) — the caller adds X-Project-Id.
 * `unusable_credential` is everything else and stays deliberately vague,
 * since distinguishing "no such key" from "revoked key", or "no such
 * project" from "another tenant's project", tells an unauthenticated caller
 * which secrets and which tenants exist.
 */
export type ProjectResolution =
  | { ok: true; resolved: ResolvedToken }
  | {
      ok: false;
      reason:
        | "unusable_credential"
        | "project_not_covered"
        | "project_ambiguous";
    };

/** The scope a role binding grants at, as resolution reads it. */
type Binding = { scopeType: RoleBindingScopeType; scopeId: string };

/** The distinct projects an API key's bindings name directly. */
function projectScopeIdsOf(roleBindings: readonly Binding[]): string[] {
  return [
    ...new Set(
      roleBindings
        .filter(
          (b) => b.scopeType === RoleBindingScopeType.PROJECT && b.scopeId,
        )
        .map((b) => b.scopeId),
    ),
  ];
}

/**
 * Which project a request acts on, and whether the CALLER named it.
 *
 * Single-project self-scoping covers the client that cannot name one — an
 * OTLP exporter sending only the bearer token, say: a key scoped to exactly
 * one project is unambiguous, so it resolves to that project. A key reaching
 * two or more (or only org / team scope) has to be told, and is asked rather
 * than refused as a bad credential.
 *
 * `named` travels with the answer because it decides whether the coverage
 * check applies: a project the key chose for itself came from its own
 * bindings and cannot exceed them.
 */
function projectToActOn({
  apiKey,
  projectId,
}: {
  apiKey: { roleBindings: readonly Binding[] };
  projectId: string | null;
}):
  | { ok: true; id: string; named: boolean }
  | { ok: false; reason: "project_ambiguous" } {
  // An empty header is a client that serialized a blank project variable, not
  // a caller naming the empty project — treated as absent, so self-scoping
  // still answers it.
  if (projectId !== null && projectId !== "") {
    return { ok: true, id: projectId, named: true };
  }

  const projectScopeIds = projectScopeIdsOf(apiKey.roleBindings);
  return projectScopeIds.length === 1
    ? { ok: true, id: projectScopeIds[0]!, named: false }
    : { ok: false, reason: "project_ambiguous" };
}

/**
 * Whether the key's own bindings reach `project` — the ancestor walk a
 * scope tier implies: an ORGANIZATION binding covers every project beneath
 * it, a TEAM binding covers that team's projects, a PROJECT binding covers
 * only itself.
 *
 * A key carrying NO bindings covers whatever its organization covers. That
 * is not a hole: it is the legacy population the read-through mint grants an
 * organization-scoped ADMIN to (`legacy-grant-mint`), plus ingestion keys,
 * and neither has a narrower grant for the caller's header to exceed. The
 * check tightens exactly the keys that carry a narrower scope, which is the
 * population the header could widen.
 */
function bindingsCoverProject({
  apiKey,
  project,
}: {
  apiKey: { roleBindings: readonly Binding[] };
  project: { id: string; team: { id: string; organizationId: string } };
}): boolean {
  if (apiKey.roleBindings.length === 0) return true;

  return apiKey.roleBindings.some(({ scopeType, scopeId }) => {
    switch (scopeType) {
      case RoleBindingScopeType.ORGANIZATION:
        return scopeId === project.team.organizationId;
      case RoleBindingScopeType.TEAM:
        return scopeId === project.team.id;
      case RoleBindingScopeType.PROJECT:
        return scopeId === project.id;
      default:
        return false;
    }
  });
}

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
    const outcome = await this.resolveProject({ token, projectId });

    return outcome.ok ? outcome.resolved : null;
  }

  /**
   * {@link resolve}, saying WHICH failure when it fails.
   *
   * The refusal a caller can act on differs by reason — widen the key, name
   * a project, or check the credential — and a bare `null` collapsed all
   * three into "invalid credentials". Surfaces that render a refusal should
   * prefer this; {@link resolve} stays for the callers that only need the
   * happy path and treat every failure alike.
   */
  async resolveProject({
    token,
    projectId,
  }: {
    token: string;
    projectId?: string | null;
  }): Promise<ProjectResolution> {
    const tokenType = getTokenType(token);
    const asLegacy = async (): Promise<ProjectResolution> => {
      const resolved = await this.resolveLegacyProjectKey(token);
      return resolved
        ? { ok: true, resolved }
        : { ok: false, reason: "unusable_credential" };
    };

    switch (tokenType) {
      case "legacyProjectKey":
        return asLegacy();
      case "apiKey": {
        const outcome = await this.resolveApiKey(token, projectId ?? null);
        // A legacy project key can be shaped exactly like a new API key
        // (its random body may contain an underscore), so when API key
        // resolution misses for an sk-lw- token, fall back to the legacy
        // lookup. The fallback only grants access when the full token
        // matches a stored project key, so misses stay a 401.
        //
        // Only an unusable credential falls back. A key that verified and
        // was refused for its SCOPE has already been identified, so retrying
        // it as a project key would replace a precise refusal with a vague
        // one — and could only ever succeed by matching a different secret.
        if (
          !outcome.ok &&
          outcome.reason === "unusable_credential" &&
          token.startsWith(API_KEY_PREFIX)
        ) {
          return asLegacy();
        }
        return outcome;
      }
      default:
        // Unknown prefix — try legacy lookup as fallback
        return asLegacy();
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
  ): Promise<ProjectResolution> {
    const apiKey = await this.apiKeyService.verify({ token });
    if (!apiKey) return { ok: false, reason: "unusable_credential" };

    const target = projectToActOn({ apiKey, projectId });
    if (!target.ok) return target;

    // Look up the project and verify it belongs to the API key's organization
    const project = await this.prisma.project.findUnique({
      where: { id: target.id, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return { ok: false, reason: "unusable_credential" };

    // Verify the project belongs to the same organization as the API key.
    // Kept a generic refusal on purpose: whether another tenant's project
    // exists is not this caller's to learn.
    if (project.team.organizationId !== apiKey.organizationId) {
      return { ok: false, reason: "unusable_credential" };
    }

    // A caller-supplied project NAMES the project to act on; it must never
    // WIDEN the key. Same-organization used to be the only guard, so a key
    // bound to one project could name any sibling and authenticate as it —
    // caught on routes that gate a permission, but handed straight to the
    // handler on routes that only authenticate.
    if (target.named && !bindingsCoverProject({ apiKey, project })) {
      return { ok: false, reason: "project_not_covered" };
    }

    return {
      ok: true,
      resolved: {
        type: "apiKey",
        apiKeyId: apiKey.id,
        userId: apiKey.userId,
        organizationId: apiKey.organizationId,
        ingestSourceType: apiKey.ingestSourceType,
        ingestionTemplateId: apiKey.ingestionTemplateId,
        isLangySessionKey: apiKey.name === LANGY_SESSION_API_KEY_NAME,
        project,
      },
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
