import { OrganizationUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { SsoConnectionService } from "~/server/sso/ssoConnection.service";
import { validateOidcDiscovery } from "~/server/sso/oidcDiscovery";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const OIDC_PROVIDERS = new Set(["okta", "azure-ad", "google", "custom-oidc"]);

const ssoConnectionProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .use(checkOrganizationPermission("organization:manage"))
  .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.SSO));

export const ssoConnectionRouter = createTRPCRouter({
  list: ssoConnectionProcedure.query(async ({ ctx, input }) => {
    const service = SsoConnectionService.create(ctx.prisma);
    const connections = await service.listConnections({
      organizationId: input.organizationId,
    });

    return connections.map((c) => ({
      id: c.id,
      domain: c.domain,
      provider: c.provider,
      verifiedAt: c.verifiedAt,
      verificationToken: c.verificationToken,
      ssoEnforced: c.ssoEnforced,
      jitProvisioning: c.jitProvisioning,
      defaultOrgRole: c.defaultOrgRole,
      clientId: c.clientId,
      issuerUrl: c.issuerUrl,
      tenantId: c.tenantId,
      samlEntityId: c.samlEntityId,
      samlSsoUrl: c.samlSsoUrl,
      attributeMapping: c.attributeMapping,
      roleMapping: c.roleMapping,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }),

  getById: ssoConnectionProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = SsoConnectionService.create(ctx.prisma);
      const connection = await service.getConnection({
        id: input.id,
        organizationId: input.organizationId,
      });

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SSO connection not found" });
      }

      return {
        id: connection.id,
        domain: connection.domain,
        provider: connection.provider,
        verifiedAt: connection.verifiedAt,
        verificationToken: connection.verificationToken,
        ssoEnforced: connection.ssoEnforced,
        jitProvisioning: connection.jitProvisioning,
        defaultOrgRole: connection.defaultOrgRole,
        clientId: connection.clientId,
        issuerUrl: connection.issuerUrl,
        tenantId: connection.tenantId,
        samlEntityId: connection.samlEntityId,
        samlSsoUrl: connection.samlSsoUrl,
        attributeMapping: connection.attributeMapping,
        roleMapping: connection.roleMapping,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      };
    }),

  create: ssoConnectionProcedure
    .input(
      z.object({
        domain: z.string().min(1).max(253),
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
        defaultOrgRole: z
          .nativeEnum(OrganizationUserRole)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (OIDC_PROVIDERS.has(input.provider) && input.issuerUrl) {
        const discovery = await validateOidcDiscovery({
          issuerUrl: input.issuerUrl,
        });
        if (!discovery.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `OIDC discovery validation failed: ${discovery.error}`,
          });
        }
      }

      const service = SsoConnectionService.create(ctx.prisma);
      const connection = await service.createConnection({
        organizationId: input.organizationId,
        domain: input.domain,
        provider: input.provider,
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

      return { id: connection.id };
    }),

  update: ssoConnectionProcedure
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
        defaultOrgRole: z
          .nativeEnum(OrganizationUserRole)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const effectiveProvider = input.provider;
      const effectiveIssuerUrl = input.issuerUrl;
      if (
        effectiveProvider &&
        OIDC_PROVIDERS.has(effectiveProvider) &&
        effectiveIssuerUrl
      ) {
        const discovery = await validateOidcDiscovery({
          issuerUrl: effectiveIssuerUrl,
        });
        if (!discovery.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `OIDC discovery validation failed: ${discovery.error}`,
          });
        }
      }

      const { id, organizationId, ...updates } = input;
      const service = SsoConnectionService.create(ctx.prisma);
      await service.updateConnection({
        id,
        organizationId,
        updates,
      });
      return { success: true };
    }),

  delete: ssoConnectionProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = SsoConnectionService.create(ctx.prisma);
      await service.deleteConnection({
        id: input.id,
        organizationId: input.organizationId,
      });
      return { success: true };
    }),

  verifyDomain: ssoConnectionProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = SsoConnectionService.create(ctx.prisma);
      return service.verifyDomain({
        id: input.id,
        organizationId: input.organizationId,
      });
    }),

  toggleEnforcement: ssoConnectionProcedure
    .input(z.object({ id: z.string(), ssoEnforced: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const service = SsoConnectionService.create(ctx.prisma);
      await service.toggleEnforcement({
        id: input.id,
        organizationId: input.organizationId,
        ssoEnforced: input.ssoEnforced,
      });
      return { success: true };
    }),

  scimLogs: ssoConnectionProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        statusFilter: z
          .enum(["all", "success", "4xx", "5xx"])
          .default("all"),
        pathSearch: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = SsoConnectionService.create(ctx.prisma);
      return service.listScimLogs({
        organizationId: input.organizationId,
        statusFilter: input.statusFilter,
        pathSearch: input.pathSearch,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),
});
