/**
 * The credential a REST request arrived with, as the thing a later permission
 * question is asked ABOUT.
 *
 * A route's declared permission is checked by the chain before the handler
 * runs. A handler that has to ask a SECOND question — "may this caller also
 * see costs?" — used to have nowhere to ask it from and answered `true`, which
 * handed a deliberately narrowed key the reach of whoever created it. This is
 * the principal that question is asked with, carried from the resolved token
 * rather than substituted for a person.
 *
 * A legacy project key is its own arm rather than a null user: it predates
 * RBAC and carries full project access by design, so a permission asked of it
 * is answered by the credential CLASS and not by a binding lookup.
 */
import type {
  ResolvedApiKeyToken,
  ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { Context } from "hono";

/**
 * The credential a project-scoped door resolved: a scoped key, or the legacy
 * project key carrying full project access by its class alone.
 * `isLangySessionKey` rides along because an agent's write is labelled apart
 * from a person's, and that fact lives on the key, not on its holder.
 */
export type RestProjectCredentialPrincipal =
  | Readonly<{
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      projectId: string;
      teamId: string;
      isLangySessionKey?: boolean;
    }>
  | Readonly<{ kind: "legacyProjectKey" }>;

/**
 * The credential an organization-scoped door resolved. Its own arm rather than
 * the project one with blank ids: an organization key names no project, and a
 * permission asked of it is asked at organization, team or route-project scope.
 */
export type RestOrganizationCredentialPrincipal = Readonly<{
  kind: "organizationApiKey";
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
}>;

export type RestCredentialPrincipal =
  | RestProjectCredentialPrincipal
  | RestOrganizationCredentialPrincipal;

/** The principal a resolved token stands for. */
export function credentialPrincipalOfToken(
  resolved: ResolvedApiKeyToken,
): RestProjectCredentialPrincipal {
  if (resolved.type !== "apiKey") return { kind: "legacyProjectKey" };
  return {
    kind: "apiKey",
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    projectId: resolved.project.id,
    teamId: resolved.project.teamId,
    ...(resolved.isLangySessionKey === undefined
      ? {}
      : { isLangySessionKey: resolved.isLangySessionKey }),
  };
}

/** The principal a resolved organization token stands for. */
export function organizationCredentialPrincipalOfToken(
  resolved: ResolvedOrganizationApiKeyToken,
): RestOrganizationCredentialPrincipal {
  return {
    kind: "organizationApiKey",
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
  };
}

/**
 * The principal behind a framework-authenticated project request.
 *
 * Raises rather than guessing when no credential was resolved: a handler
 * asking this on an unauthenticated request is a mis-wired route, and reading
 * a blank principal would widen an answer instead of failing. A plain `Error`
 * on purpose — it degrades to the generic unknown response (ADR-045) and logs
 * loudly, because no caller can act on it.
 */
export function credentialPrincipalOf(c: Context): RestProjectCredentialPrincipal {
  const resolved = c.get("resolvedToken") as ResolvedApiKeyToken | undefined;
  if (!resolved) {
    throw new Error(
      "A handler asked for the request's credential principal with no resolved credential — mount the project authentication middleware before it",
    );
  }
  return credentialPrincipalOfToken(resolved);
}

/**
 * The principal behind a framework-authenticated organization request. Raises
 * for the reason its project sibling does: a door that resolved no credential
 * is mis-wired, and a blank principal widens the question instead of failing.
 */
export function organizationCredentialPrincipalOf(c: Context): RestOrganizationCredentialPrincipal {
  const resolved = c.get("orgResolvedToken") as ResolvedOrganizationApiKeyToken | undefined;
  if (!resolved) {
    throw new Error(
      "A handler asked for the request's organization credential principal with no resolved credential — mount the organization authentication middleware before it",
    );
  }
  return organizationCredentialPrincipalOfToken(resolved);
}
