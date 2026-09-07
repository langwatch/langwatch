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
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { Context } from "hono";

export type RestCredentialPrincipal =
  | Readonly<{
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      projectId: string;
      teamId: string;
    }>
  | Readonly<{ kind: "legacyProjectKey" }>;

/** The principal a resolved token stands for. */
export function credentialPrincipalOfToken(resolved: ResolvedApiKeyToken): RestCredentialPrincipal {
  if (resolved.type !== "apiKey") return { kind: "legacyProjectKey" };
  return {
    kind: "apiKey",
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    projectId: resolved.project.id,
    teamId: resolved.project.teamId,
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
export function credentialPrincipalOf(c: Context): RestCredentialPrincipal {
  const resolved = c.get("resolvedToken") as ResolvedApiKeyToken | undefined;
  if (!resolved) {
    throw new Error(
      "A handler asked for the request's credential principal with no resolved credential — mount the project authentication middleware before it",
    );
  }
  return credentialPrincipalOfToken(resolved);
}
