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
