import { z } from "zod";

import type { Actor } from "./actor.ts";

/** Who authz checks a credential as: a person, or an API key's own row. */
export const principalRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string() }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string() }).strict(),
]);
export type PrincipalRef = z.infer<typeof principalRefSchema>;

// The project and the credential a REST request arrives with. These are the
// project and API-key contracts' own values — described rather than imported to
// avoid a declaration cycle. The structural check is field for field.

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
      /** Set on an ownerless run key minted for a run nobody started: it acts as the system. */
      isUnattendedRunKey?: boolean;
      project: RestProjectIdentity;
    }
  | {
      /** A person's access token (CLI, hosted MCP): no key row, it acts as the person. */
      type: "cliAccessToken";
      userId: string;
      organizationId: string;
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

// The credential a REST request arrived with. Handlers that ask secondary permission
// questions ("may this caller also see costs?") need to ask them about the resolved
// credential, not the declared permission checked before the handler runs.

/**
 * The credential a project-scoped door resolved: a scoped key, or the legacy project key
 * carrying full project access by its class alone. `isLangySessionKey` rides along because
 * an agent's write is labelled apart from a person's, and that fact lives on the key.
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
  | Readonly<{
      kind: "cliAccessToken";
      userId: string;
      organizationId: string;
      projectId: string;
      teamId: string;
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

/**
 * What the key door resolved (#8085): a legacy project key IS its project; any other key reaches
 * its organization, and names the project it resolved to when the request selected one.
 */
export type RestKeyCredentialPrincipal =
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      resolvedProject?: Readonly<{ id: string; teamId: string }>;
    }>;

/**
 * Everything the key door lets in: any API key, or a project-bound access token as its person.
 * A feature that serves API keys only reads the narrower {@link RestKeyCredentialPrincipal}.
 */
export type RestKeyDoorPrincipal =
  | RestKeyCredentialPrincipal
  | Extract<RestProjectCredentialPrincipal, { kind: "cliAccessToken" }>;

/** What the caller presented: the bearer key, the project it names, and its session's address. */
export type SessionKeyPresented = Readonly<{
  token: string;
  projectId: string | null;
  instanceToken: string | null;
}>;

/** Who the minting module says holds the key, and the project the key is bound to. */
export type SessionKeyHolder = Readonly<{ actor: Actor; projectId: string }>;
