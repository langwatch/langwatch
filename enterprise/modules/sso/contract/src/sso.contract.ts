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
 * One connection as the back office reads it. Named fields, not `unknown`: a
 * tRPC procedure publishes what its handler returns, so an `unknown` here is
 * what the browser gets, and the list reads every row field below.
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

export type BackofficeSsoConnection = z.infer<typeof backofficeSsoConnectionSchema>;
export type BackofficeSsoConnectionPage = z.infer<typeof backofficeSsoConnectionPageSchema>;

/** One page of the back office's list, as the pager asks for it. */
export const listSsoConnectionsInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(253).optional(),
});
export type ListSsoConnectionsInput = z.infer<typeof listSsoConnectionsInputSchema>;

export const ssoConnectionByIdSchema = z.object({ connectionId: z.string().min(1) });
export type SsoConnectionByIdInput = z.infer<typeof ssoConnectionByIdSchema>;

/**
 * The organization is routing, not reach: it says whose connection history the
 * command is appended to. Who may issue it is the staff list, and nothing else.
 */
export const ssoConnectionTargetSchema = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});
export type SsoConnectionTarget = z.infer<typeof ssoConnectionTargetSchema>;

export const ssoDomainTargetSchema = z.object({
  ...ssoConnectionTargetSchema.shape,
  domain: z.string().min(1).max(253),
});
export type SsoDomainTarget = z.infer<typeof ssoDomainTargetSchema>;

export const rejectSsoDomainClaimInputSchema = z.object({
  ...ssoDomainTargetSchema.shape,
  note: z.string().min(1).max(1000),
});
export type RejectSsoDomainClaimInput = z.infer<typeof rejectSsoDomainClaimInputSchema>;

/**
 * The protocol union the aggregate speaks, so a SAML request reaches the ledger
 * and is refused BY NAME. Narrowing it to `"oidc"` would tell the operator the
 * field is wrong rather than that the protocol is not self-serve yet.
 */
export const registerSsoConnectionInputSchema = z.object({
  organizationId: z.string().min(1),
  type: z.enum(["oidc", "saml"]),
  providerId: z.string().min(1).max(100),
  issuer: z.string().max(2048).nullable().default(null),
  allowsJit: z.boolean().default(false),
});
export type RegisterSsoConnectionInput = z.infer<typeof registerSsoConnectionInputSchema>;

export const activateSsoConnectionInputSchema = z.object({
  ...ssoConnectionTargetSchema.shape,
  testLoginAccountId: z.string().min(1),
});
export type ActivateSsoConnectionInput = z.infer<typeof activateSsoConnectionInputSchema>;

/** Suspending and requesting a teardown both carry the same optional reason. */
export const ssoConnectionReasonInputSchema = z.object({
  ...ssoConnectionTargetSchema.shape,
  reason: z.string().min(1).max(1000).nullable().default(null),
});
export type SsoConnectionReasonInput = z.infer<typeof ssoConnectionReasonInputSchema>;
