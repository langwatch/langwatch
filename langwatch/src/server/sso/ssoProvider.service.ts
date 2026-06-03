import type { OrganizationUserRole, PrismaClient, SsoProvider } from "@prisma/client";
import { DiscoveryError, discoverOIDCConfig } from "@better-auth/sso";
import { createLogger } from "../../utils/logger/server";
import { verifyDomainDns } from "./dnsVerification";
import { SsoProviderRepository } from "./ssoProvider.repository";
import { ScimRequestLogRepository } from "./scimRequestLog.repository";

const logger = createLogger("langwatch:sso:provider");

/**
 * Providers we treat as OIDC. `custom-saml` is the only SAML provider; anything
 * else is configured through the @better-auth/sso plugin's OIDC path.
 */
const OIDC_PROVIDERS = new Set(["okta", "azure-ad", "google", "custom-oidc"]);

export interface CreateSsoProviderInput {
  organizationId: string;
  userId: string;
  provider: string;
  domain: string;
  clientId?: string | null;
  clientSecret?: string | null;
  issuerUrl?: string | null;
  tenantId?: string | null;
  samlEntityId?: string | null;
  samlSsoUrl?: string | null;
  samlCertificate?: string | null;
  attributeMapping?: Record<string, unknown> | null;
  roleMapping?: Record<string, unknown> | null;
  ssoEnforced?: boolean;
  jitProvisioning?: boolean;
  defaultOrgRole?: OrganizationUserRole;
}

/**
 * Manages per-org SSO providers consumed by the @better-auth/sso plugin.
 *
 * The plugin owns the login/callback runtime; this service owns configuration:
 * it resolves the OIDC issuer, hydrates the discovery document with the
 * plugin's own `discoverOIDCConfig` helper, shapes the `oidcConfig` /
 * `samlConfig` blobs exactly as the plugin reads them at login, and persists
 * through SsoProviderRepository (secrets are encrypted by Prisma middleware).
 *
 * We deliberately do NOT call the plugin's HTTP `registerSSOProvider` endpoint:
 * its discovery enforces better-auth `trustedOrigins`, which we cannot enumerate
 * for arbitrary customer IdPs. Hydrating in-process with our own SSRF guard
 * supports any public IdP while still reusing the plugin's discovery logic.
 */
export class SsoProviderService {
  private readonly repository: SsoProviderRepository;
  private readonly scimLogRepository: ScimRequestLogRepository;

  constructor(
    prisma: PrismaClient,
    private readonly baseUrl: string,
  ) {
    this.repository = SsoProviderRepository.create(prisma);
    this.scimLogRepository = ScimRequestLogRepository.create(prisma);
  }

  static create(prisma: PrismaClient, baseUrl: string): SsoProviderService {
    return new SsoProviderService(prisma, baseUrl);
  }

  async listProviders({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoProvider[]> {
    return this.repository.findAllByOrganization({ organizationId });
  }

  async getProvider({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<SsoProvider | null> {
    return this.repository.findById({ id, organizationId });
  }

  /** Enforcement lookup: is password login blocked for this email domain? */
  async getEnforcedProviderByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ organizationId: string } | null> {
    return this.repository.findEnforcedByDomain({ domain });
  }

  /**
   * Role-mapping policy for a verified provider on this domain+org. Used by the
   * instance-level (genericOAuth) sign-in hook to mirror per-org role mapping.
   */
  async getRoleMappingByDomain({
    domain,
    organizationId,
  }: {
    domain: string;
    organizationId: string;
  }): Promise<{ roleMapping: unknown; defaultOrgRole: string } | null> {
    const providers = await this.repository.findAllByOrganization({
      organizationId,
    });
    const match = providers.find(
      (p) => p.domain === domain && p.domainVerified,
    );
    if (!match) return null;
    return { roleMapping: match.roleMapping, defaultOrgRole: match.defaultOrgRole };
  }

  /** Policy needed by the plugin's provisionUser bridge, keyed by providerId. */
  async getPolicyByProviderId({
    providerId,
  }: {
    providerId: string;
  }): Promise<{
    organizationId: string | null;
    jitProvisioning: boolean;
    defaultOrgRole: OrganizationUserRole;
    roleMapping: unknown;
  } | null> {
    const provider = await this.repository.findByProviderId({ providerId });
    if (!provider) return null;
    return {
      organizationId: provider.organizationId,
      jitProvisioning: provider.jitProvisioning,
      defaultOrgRole: provider.defaultOrgRole,
      roleMapping: provider.roleMapping,
    };
  }

  async createProvider(input: CreateSsoProviderInput): Promise<SsoProvider> {
    const isSaml = input.provider === "custom-saml";
    const providerId = this.buildProviderId({
      domain: input.domain,
      kind: isSaml ? "saml" : "oidc",
    });

    const { issuer, oidcConfig, samlConfig } = isSaml
      ? await this.buildSamlConfig({ ...input, providerId })
      : await this.buildOidcConfig({ ...input, providerId });

    return this.repository.create({
      organizationId: input.organizationId,
      userId: input.userId,
      providerId,
      issuer,
      domain: input.domain,
      oidcConfig,
      samlConfig,
      ssoEnforced: input.ssoEnforced ?? false,
      jitProvisioning: input.jitProvisioning ?? false,
      defaultOrgRole: input.defaultOrgRole ?? "MEMBER",
      roleMapping: input.roleMapping ?? null,
    });
  }

  async updateProvider({
    id,
    organizationId,
    updates,
  }: {
    id: string;
    organizationId: string;
    updates: Partial<CreateSsoProviderInput>;
  }): Promise<SsoProvider> {
    const existing = await this.repository.findById({ id, organizationId });
    if (!existing) {
      // delegate to repository for the canonical not-found error
      return this.repository.update({ id, organizationId, data: {} });
    }

    const data: Parameters<SsoProviderRepository["update"]>[0]["data"] = {};

    // Re-hydrate protocol config only when protocol inputs are present.
    const touchingOidc =
      updates.clientId !== undefined ||
      updates.clientSecret !== undefined ||
      updates.issuerUrl !== undefined ||
      updates.tenantId !== undefined ||
      updates.attributeMapping !== undefined;
    const touchingSaml =
      updates.samlEntityId !== undefined ||
      updates.samlSsoUrl !== undefined ||
      updates.samlCertificate !== undefined;

    if (existing.samlConfig && touchingSaml) {
      const built = await this.buildSamlConfig({
        organizationId,
        userId: existing.userId ?? "",
        provider: "custom-saml",
        domain: existing.domain,
        providerId: existing.providerId,
        samlEntityId: updates.samlEntityId ?? undefined,
        samlSsoUrl: updates.samlSsoUrl ?? undefined,
        samlCertificate: updates.samlCertificate ?? undefined,
        attributeMapping: updates.attributeMapping ?? undefined,
      });
      data.issuer = built.issuer;
      data.samlConfig = built.samlConfig;
    } else if (!existing.samlConfig && touchingOidc) {
      const built = await this.buildOidcConfig({
        organizationId,
        userId: existing.userId ?? "",
        provider: this.inferOidcProvider(existing),
        domain: existing.domain,
        providerId: existing.providerId,
        clientId: updates.clientId ?? undefined,
        clientSecret: updates.clientSecret ?? undefined,
        issuerUrl: updates.issuerUrl ?? existing.issuer,
        tenantId: updates.tenantId ?? undefined,
        attributeMapping: updates.attributeMapping ?? undefined,
      });
      data.issuer = built.issuer;
      data.oidcConfig = built.oidcConfig;
    }

    if (updates.ssoEnforced !== undefined) data.ssoEnforced = updates.ssoEnforced;
    if (updates.jitProvisioning !== undefined)
      data.jitProvisioning = updates.jitProvisioning;
    if (updates.defaultOrgRole !== undefined)
      data.defaultOrgRole = updates.defaultOrgRole;
    if (updates.roleMapping !== undefined) data.roleMapping = updates.roleMapping;

    return this.repository.update({ id, organizationId, data });
  }

  async deleteProvider({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    return this.repository.delete({ id, organizationId });
  }

  async toggleEnforcement({
    id,
    organizationId,
    ssoEnforced,
  }: {
    id: string;
    organizationId: string;
    ssoEnforced: boolean;
  }): Promise<SsoProvider> {
    return this.repository.update({
      id,
      organizationId,
      data: { ssoEnforced },
    });
  }

  /** DNS-TXT proof of domain ownership; flips the plugin's login gate. */
  async verifyDomain({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<{ verified: boolean }> {
    const provider = await this.repository.findById({ id, organizationId });
    if (!provider) return { verified: false };
    if (provider.domainVerified) return { verified: true };

    const verified = await verifyDomainDns({
      domain: provider.domain,
      expectedToken: provider.verificationToken,
    });

    if (verified) {
      await this.repository.update({
        id,
        organizationId,
        data: { domainVerified: true },
      });
    }

    return { verified };
  }

  async listScimLogs(params: {
    organizationId: string;
    statusFilter?: "all" | "success" | "4xx" | "5xx";
    pathSearch?: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: Array<{
      id: string;
      method: string;
      path: string;
      status: number;
      duration: number;
      identityProvider: string | null;
      createdAt: Date;
    }>;
    nextCursor: string | undefined;
  }> {
    const result = await this.scimLogRepository.findByOrganization(params);
    return {
      items: result.items.map((log) => ({
        id: log.id,
        method: log.requestMethod,
        path: log.requestPath,
        status: log.responseStatus,
        duration: log.durationMs,
        identityProvider: log.identityProvider,
        createdAt: log.createdAt,
      })),
      nextCursor: result.nextCursor,
    };
  }

  // ── config builders ───────────────────────────────────────────────

  private buildProviderId({
    domain,
    kind,
  }: {
    domain: string;
    kind: "oidc" | "saml";
  }): string {
    const slug = domain.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    // A short random suffix keeps providerId unique if a domain is reconfigured
    // (delete + re-add) and avoids leaking that two orgs share a domain slug.
    const suffix = Math.abs(hashString(`${domain}:${kind}:${Date.now()}`)).toString(
      36,
    );
    return `${slug}-${kind}-${suffix}`;
  }

  private inferOidcProvider(existing: SsoProvider): string {
    if (existing.issuer.includes("login.microsoftonline.com")) return "azure-ad";
    if (existing.issuer.includes("accounts.google.com")) return "google";
    return "custom-oidc";
  }

  private resolveIssuer({
    provider,
    issuerUrl,
    tenantId,
  }: {
    provider: string;
    issuerUrl?: string | null;
    tenantId?: string | null;
  }): string {
    if (provider === "google") return "https://accounts.google.com";
    if (provider === "azure-ad") {
      if (!tenantId) throw new Error("Azure AD requires a tenant ID");
      return `https://login.microsoftonline.com/${tenantId}/v2.0`;
    }
    if (!issuerUrl) throw new Error(`Provider ${provider} requires an issuer URL`);
    return issuerUrl.replace(/\/+$/, "");
  }

  private async buildOidcConfig(
    input: CreateSsoProviderInput & { providerId: string },
  ): Promise<{ issuer: string; oidcConfig: string; samlConfig: null }> {
    if (!OIDC_PROVIDERS.has(input.provider)) {
      throw new Error(`Unsupported OIDC provider: ${input.provider}`);
    }
    if (!input.clientId || !input.clientSecret) {
      throw new Error("OIDC providers require a client ID and client secret");
    }

    const issuer = this.resolveIssuer({
      provider: input.provider,
      issuerUrl: input.issuerUrl,
      tenantId: input.tenantId,
    });

    let hydrated;
    try {
      hydrated = await discoverOIDCConfig({
        issuer,
        existingConfig: {
          discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
        },
        isTrustedOrigin: isSsrfSafeOrigin,
      });
    } catch (err) {
      if (err instanceof DiscoveryError) {
        logger.warn({ err, issuer }, "OIDC discovery failed");
        throw new Error(`OIDC discovery failed: ${err.message}`);
      }
      throw err;
    }

    const attr = (input.attributeMapping ?? {}) as Record<string, string>;
    const oidcConfig = {
      issuer: hydrated.issuer,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      authorizationEndpoint: hydrated.authorizationEndpoint,
      tokenEndpoint: hydrated.tokenEndpoint,
      tokenEndpointAuthentication: "client_secret_basic" as const,
      jwksEndpoint: hydrated.jwksEndpoint,
      pkce: true,
      discoveryEndpoint: hydrated.discoveryEndpoint,
      userInfoEndpoint: hydrated.userInfoEndpoint,
      scopes: ["openid", "email", "profile"],
      mapping: {
        id: attr.id ?? "sub",
        email: attr.email ?? "email",
        name: attr.name ?? "name",
        image: attr.image ?? "picture",
      },
      overrideUserInfo: false,
    };

    return { issuer, oidcConfig: JSON.stringify(oidcConfig), samlConfig: null };
  }

  private async buildSamlConfig(
    input: CreateSsoProviderInput & { providerId: string },
  ): Promise<{ issuer: string; oidcConfig: null; samlConfig: string }> {
    if (!input.samlEntityId || !input.samlSsoUrl || !input.samlCertificate) {
      throw new Error(
        "SAML providers require an entity ID, SSO URL, and X.509 certificate",
      );
    }

    // The SP audience/entity ID the IdP asserts against. Stable per provider.
    const audience = `${this.baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${input.providerId}`;
    const callbackUrl = `${this.baseUrl}/api/auth/sso/saml2/callback/${input.providerId}`;

    const attr = (input.attributeMapping ?? {}) as Record<string, string>;
    const samlConfig = {
      issuer: input.samlEntityId,
      entryPoint: input.samlSsoUrl,
      cert: input.samlCertificate,
      callbackUrl,
      audience,
      wantAssertionsSigned: true,
      identifierFormat:
        "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      mapping: {
        id: attr.id ?? "nameID",
        email: attr.email ?? "email",
        name: attr.name ?? "name",
      },
    };

    return {
      issuer: input.samlEntityId,
      oidcConfig: null,
      samlConfig: JSON.stringify(samlConfig),
    };
  }
}

/**
 * SSRF guard for IdP discovery/metadata fetches: only public HTTPS origins.
 * Mirrors the protection the hand-rolled client used to carry, supplied to the
 * plugin's `discoverOIDCConfig` as its `isTrustedOrigin` tester.
 */
function isSsrfSafeOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return false;
  }
  return true;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
