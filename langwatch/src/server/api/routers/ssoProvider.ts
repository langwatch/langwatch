import { OrganizationUserRole, type SsoProvider } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { getApp } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const ssoProviderProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .use(checkOrganizationPermission("organization:manage"))
  .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.SSO));

/**
 * Project a stored SsoProvider into a UI-safe shape. Protocol config lives in
 * the encrypted `oidcConfig` / `samlConfig` JSON blobs; we surface only the
 * non-secret fields the settings form needs and NEVER return the OIDC client
 * secret or SAML certificate / private keys.
 */
function toClientView(provider: SsoProvider) {
  const oidc = safeParse(provider.oidcConfig);
  const saml = safeParse(provider.samlConfig);

  const issuer = (oidc?.issuer as string | undefined) ?? null;
  let kind: string;
  if (saml) kind = "custom-saml";
  else if (issuer?.includes("login.microsoftonline.com")) kind = "azure-ad";
  else if (issuer === "https://accounts.google.com") kind = "google";
  else if (issuer?.includes("okta")) kind = "okta";
  else kind = "custom-oidc";

  const tenantId =
    kind === "azure-ad" && issuer
      ? (issuer.match(/login\.microsoftonline\.com\/([^/]+)/)?.[1] ?? null)
      : null;

  return {
    id: provider.id,
    providerId: provider.providerId,
    domain: provider.domain,
    provider: kind,
    domainVerified: provider.domainVerified,
    verificationToken: provider.verificationToken,
    ssoEnforced: provider.ssoEnforced,
    jitProvisioning: provider.jitProvisioning,
    defaultOrgRole: provider.defaultOrgRole,
    roleMapping: provider.roleMapping,
    issuerUrl: issuer,
    clientId: (oidc?.clientId as string | undefined) ?? null,
    tenantId,
    samlEntityId: (saml?.issuer as string | undefined) ?? null,
    samlSsoUrl: (saml?.entryPoint as string | undefined) ?? null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function safeParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const providerConfigInput = {
  provider: z.string().min(1),
  clientId: z.string().min(1).nullish(),
  clientSecret: z.string().min(1).nullish(),
  issuerUrl: z.string().nullish(),
  tenantId: z.string().nullish(),
  samlEntityId: z.string().nullish(),
  samlSsoUrl: z.string().nullish(),
  samlCertificate: z.string().nullish(),
  attributeMapping: z.record(z.unknown()).nullish(),
  roleMapping: z.record(z.unknown()).nullish(),
  ssoEnforced: z.boolean().optional(),
  jitProvisioning: z.boolean().optional(),
  defaultOrgRole: z.nativeEnum(OrganizationUserRole).optional(),
};

export const ssoProviderRouter = createTRPCRouter({
  list: ssoProviderProcedure.query(async ({ input }) => {
    const providers = await getApp().ssoProvider.listProviders({
      organizationId: input.organizationId,
    });
    return providers.map(toClientView);
  }),

  getById: ssoProviderProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const provider = await getApp().ssoProvider.getProvider({
        id: input.id,
        organizationId: input.organizationId,
      });
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSO provider not found",
        });
      }
      return toClientView(provider);
    }),

  create: ssoProviderProcedure
    .input(
      z.object({
        domain: z
          .string()
          .min(1)
          .max(253)
          .transform((d) => d.trim().toLowerCase()),
        ...providerConfigInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const provider = await getApp().ssoProvider.createProvider({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        provider: input.provider,
        domain: input.domain,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        issuerUrl: input.issuerUrl,
        tenantId: input.tenantId,
        samlEntityId: input.samlEntityId,
        samlSsoUrl: input.samlSsoUrl,
        samlCertificate: input.samlCertificate,
        attributeMapping: input.attributeMapping,
        roleMapping: input.roleMapping,
        ssoEnforced: input.ssoEnforced,
        jitProvisioning: input.jitProvisioning,
        defaultOrgRole: input.defaultOrgRole,
      });
      return { id: provider.id };
    }),

  update: ssoProviderProcedure
    .input(
      z.object({
        id: z.string(),
        provider: z.string().min(1).optional(),
        clientId: z.string().min(1).nullish(),
        clientSecret: z.string().min(1).nullish(),
        issuerUrl: z.string().nullish(),
        tenantId: z.string().nullish(),
        samlEntityId: z.string().nullish(),
        samlSsoUrl: z.string().nullish(),
        samlCertificate: z.string().nullish(),
        attributeMapping: z.record(z.unknown()).nullish(),
        roleMapping: z.record(z.unknown()).nullish(),
        ssoEnforced: z.boolean().optional(),
        jitProvisioning: z.boolean().optional(),
        defaultOrgRole: z.nativeEnum(OrganizationUserRole).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, organizationId, ...updates } = input;
      await getApp().ssoProvider.updateProvider({ id, organizationId, updates });
      return { success: true };
    }),

  delete: ssoProviderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await getApp().ssoProvider.deleteProvider({
        id: input.id,
        organizationId: input.organizationId,
      });
      return { success: true };
    }),

  verifyDomain: ssoProviderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return getApp().ssoProvider.verifyDomain({
        id: input.id,
        organizationId: input.organizationId,
      });
    }),

  toggleEnforcement: ssoProviderProcedure
    .input(z.object({ id: z.string(), ssoEnforced: z.boolean() }))
    .mutation(async ({ input }) => {
      await getApp().ssoProvider.toggleEnforcement({
        id: input.id,
        organizationId: input.organizationId,
        ssoEnforced: input.ssoEnforced,
      });
      return { success: true };
    }),

  scimLogs: ssoProviderProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        statusFilter: z.enum(["all", "success", "4xx", "5xx"]).default("all"),
        pathSearch: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return getApp().ssoProvider.listScimLogs({
        organizationId: input.organizationId,
        statusFilter: input.statusFilter,
        pathSearch: input.pathSearch,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),
});
