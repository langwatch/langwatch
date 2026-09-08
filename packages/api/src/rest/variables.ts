import type {
  RestProjectIdentity,
  RestResolvedOrganizationCredential,
  RestResolvedProjectCredential,
} from "./credential.ts";

/**
 * The request context a project-scoped REST family sees.
 *
 * Written by the process's own project authentication, which is supplied to
 * the REST security policy as a port.
 *
 * `project` is the project identity — the same value the resolved credential
 * carries, so the credential a request arrives with and the project a handler
 * reads agree by construction. It answers who the project is; 352 of the 355
 * field reads across every handler are its id, slug, teamId or name. A handler
 * that needs configuration asks `ProjectService`, which is the read it would
 * have made anyway.
 */
export type AppRestProjectVariables = {
  project: RestProjectIdentity;
  apiKeyId?: string;
  apiKeyUserId?: string;
  apiKeyOrganizationId?: string;
  /**
   * The full resolved credential. Always set by the unified authentication
   * middleware; optional here because other middleware sharing this shape do
   * not set it. Handlers that need to know WHICH kind of credential called
   * (scoped API key vs legacy project key) read this.
   */
  resolvedToken?: RestResolvedProjectCredential;
};

/**
 * The request context an organization-scoped REST family sees.
 *
 * `organization` carries only an id because that is all an organization
 * credential resolves to: the resolved token is
 * `{ type, apiKeyId, userId, organizationId }` and the organization feature
 * publishes no scalar organization value. A family that needs more asks the
 * organization service for it.
 */
export type AppRestOrganizationVariables = {
  organization: { id: RestResolvedOrganizationCredential["organizationId"] };
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: RestResolvedOrganizationCredential;
};
