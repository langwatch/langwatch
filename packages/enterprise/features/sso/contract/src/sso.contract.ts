import { z } from "zod";

export const SSO_FEATURE_ID = "sso" as const;

const optionalCredentialSchema = z.string().min(1).optional();

/** Explicit SSO configuration supplied by an application composition root. */
export const ssoConfigurationSchema = z.object({
  isSaas: z.boolean(),
  provider: z.string().min(1),
  baseUrl: z.string().min(1),
  instanceLicenseKey: optionalCredentialSchema,
  googleClientId: optionalCredentialSchema,
  googleClientSecret: optionalCredentialSchema,
  githubClientId: optionalCredentialSchema,
  githubClientSecret: optionalCredentialSchema,
  gitlabClientId: optionalCredentialSchema,
  gitlabClientSecret: optionalCredentialSchema,
  azureAdClientId: optionalCredentialSchema,
  azureAdClientSecret: optionalCredentialSchema,
  azureAdTenantId: optionalCredentialSchema,
  auth0ClientId: optionalCredentialSchema,
  auth0ClientSecret: optionalCredentialSchema,
  auth0Issuer: optionalCredentialSchema,
  oktaClientId: optionalCredentialSchema,
  oktaClientSecret: optionalCredentialSchema,
  oktaIssuer: optionalCredentialSchema,
  cognitoClientId: optionalCredentialSchema,
  cognitoClientSecret: optionalCredentialSchema,
  cognitoIssuer: optionalCredentialSchema,
  oneLoginClientId: optionalCredentialSchema,
  oneLoginClientSecret: optionalCredentialSchema,
  oneLoginIssuer: optionalCredentialSchema,
  oidcClientId: optionalCredentialSchema,
  oidcClientSecret: optionalCredentialSchema,
  oidcIssuer: optionalCredentialSchema,
});

export type SsoConfiguration = z.infer<typeof ssoConfigurationSchema>;

/**
 * One connection as the back office reads it.
 *
 * Named fields, not `unknown`: a tRPC procedure publishes what its handler
 * returns, so an `unknown` here is what the browser gets, and the back-office
 * list reads `total`, `connections` and every row field below.
 */
export const backofficeSsoConnectionSchema = z
  .object({
    connectionId: z.string(),
    organizationId: z.string(),
    /** Null when the organization no longer exists. */
    organizationName: z.string().nullable(),
    type: z.string(),
    state: z.string(),
    claimedDomains: z.array(z.string()),
    approvedDomains: z.array(z.string()),
    verifiedDomains: z.array(z.string()),
    domainVerifications: z.array(
      z
        .object({
          domain: z.string(),
          method: z.string(),
          actorId: z.string().nullable(),
          verifiedAtMs: z.number(),
        })
        .strict(),
    ),
    providerId: z.string(),
    issuer: z.string().nullable(),
    allowsJit: z.boolean(),
    source: z.string(),
    testLoginAccountId: z.string().nullable(),
    rejection: z.object({ domain: z.string(), note: z.string() }).strict().nullable(),
    pendingVerificationDomain: z.string().nullable(),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
  })
  .strict();

/** One page of connections, with the total the pager reads. */
export const backofficeSsoConnectionPageSchema = z
  .object({
    connections: z.array(backofficeSsoConnectionSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();
