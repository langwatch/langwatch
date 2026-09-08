/**
 * The project and the credential a REST request arrives with, stated as the
 * fields the transport reads.
 *
 * These are the project and API-key contracts' own values, described rather
 * than imported. Those contracts declare their tRPC procedures with
 * `@langwatch/api/contract`, so a transport module importing them back would
 * close a declaration cycle. The process door hands in the feature's value and
 * the check is structural: field for field, these are the same shapes.
 */

/**
 * Who a project is, and nothing about how it is configured — the value the
 * project contract publishes as its identity. A handler that needs
 * configuration asks the project service for it.
 */
export type RestProjectIdentity = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  organizationId: string;
  /** Whether the workspace belongs to exactly one person. */
  isPersonal: boolean;
  /** That person, when the workspace is personal. */
  ownerUserId: string | null;
};

/**
 * The credential a project-scoped door resolved: a scoped API key, or the
 * legacy project key, which predates RBAC and carries full project access by
 * its class alone.
 */
export type RestResolvedProjectCredential =
  | {
      type: "legacyProjectKey";
      project: RestProjectIdentity;
    }
  | {
      type: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      ingestSourceType: string | null;
      ingestionTemplateId: string | null;
      /** Set when the key belongs to an agent session rather than a person. */
      isLangySessionKey?: boolean;
      project: RestProjectIdentity;
    };

/**
 * The credential an organization-scoped door resolved. It names no project: a
 * permission asked of it is asked at organization, team or route-project scope.
 */
export type RestResolvedOrganizationCredential = {
  type: "apiKey-org";
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
};
