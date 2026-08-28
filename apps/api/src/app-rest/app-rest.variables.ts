import type {
  ResolvedApiKeyToken,
  ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { Organization, Project } from "@langwatch/prisma-client/generated";

/**
 * The request context a project-scoped REST family sees.
 *
 * Written by the process's own project authentication, which is supplied to
 * {@link createAppRestSecurity} as a port. Named here because a REST feature
 * that lives in this process needs the shape to type its handlers, and the
 * transport package deliberately refuses to name it: doing so would put Prisma
 * behind `@langwatch/api`.
 */
export type AppRestProjectVariables = {
  project: Project;
  apiKeyId?: string;
  apiKeyUserId?: string;
  apiKeyOrganizationId?: string;
  /**
   * The full resolved credential. Always set by the unified authentication
   * middleware; optional here because other middleware sharing this shape do
   * not set it. Handlers that need to know WHICH kind of credential called
   * (scoped API key vs legacy project key) read this.
   */
  resolvedToken?: ResolvedApiKeyToken;
};

/** The request context an organization-scoped REST family sees. */
export type AppRestOrganizationVariables = {
  organization: Organization;
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: ResolvedOrganizationApiKeyToken;
};
