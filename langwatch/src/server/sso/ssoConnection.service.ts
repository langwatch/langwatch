import type { PrismaClient, ScimRequestLog, SsoConnection } from "@prisma/client";
import { encrypt } from "../../utils/encryption";
import { verifyDomainDns } from "./dnsVerification";
import { SsoConnectionRepository } from "./ssoConnection.repository";
import { ScimRequestLogRepository } from "./scimRequestLog.repository";

export class SsoConnectionService {
  private readonly repository: SsoConnectionRepository;
  private readonly scimLogRepository: ScimRequestLogRepository;

  constructor(prisma: PrismaClient) {
    this.repository = SsoConnectionRepository.create(prisma);
    this.scimLogRepository = ScimRequestLogRepository.create(prisma);
  }

  static create(prisma: PrismaClient): SsoConnectionService {
    return new SsoConnectionService(prisma);
  }

  async getVerifiedConnectionByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<SsoConnection | null> {
    return this.repository.findVerifiedByDomain({ domain });
  }

  async getEnforcedConnectionByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ organizationId: string } | null> {
    return this.repository.findEnforcedByDomain({ domain });
  }

  async listConnections({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnection[]> {
    return this.repository.findAllByOrganization({ organizationId });
  }

  async getConnection({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<SsoConnection | null> {
    return this.repository.findById({ id, organizationId });
  }

  async createConnection({
    organizationId,
    domain,
    provider,
    clientId,
    clientSecret,
    issuerUrl,
    tenantId,
    samlEntityId,
    samlSsoUrl,
    samlCertificate,
    attributeMapping,
    roleMapping,
    ssoEnforced,
    jitProvisioning,
    defaultOrgRole,
  }: {
    organizationId: string;
    domain: string;
    provider: string;
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
    defaultOrgRole?: "ADMIN" | "MEMBER" | "EXTERNAL";
  }): Promise<SsoConnection> {
    const clientSecretEnc = clientSecret ? encrypt(clientSecret) : null;

    return this.repository.create({
      organizationId,
      domain,
      provider,
      clientId: clientId ?? null,
      clientSecretEnc,
      issuerUrl,
      tenantId,
      samlEntityId,
      samlSsoUrl,
      samlCertificate,
      attributeMapping,
      roleMapping,
      ssoEnforced,
      jitProvisioning,
      defaultOrgRole,
    });
  }

  async updateConnection({
    id,
    organizationId,
    updates,
  }: {
    id: string;
    organizationId: string;
    updates: {
      provider?: string;
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
      defaultOrgRole?: "ADMIN" | "MEMBER" | "EXTERNAL";
    };
  }): Promise<SsoConnection> {
    const { clientSecret, ...rest } = updates;

    return this.repository.update({
      id,
      organizationId,
      data: {
        ...rest,
        ...(clientSecret
          ? { clientSecretEnc: encrypt(clientSecret) }
          : {}),
      },
    });
  }

  async deleteConnection({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    return this.repository.delete({ id, organizationId });
  }

  async verifyDomain({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<{ verified: boolean }> {
    const connection = await this.repository.findById({ id, organizationId });
    if (!connection) {
      return { verified: false };
    }

    if (connection.verifiedAt) {
      return { verified: true };
    }

    const verified = await verifyDomainDns({
      domain: connection.domain,
      expectedToken: connection.verificationToken,
    });

    if (verified) {
      await this.repository.update({
        id,
        organizationId,
        data: { verifiedAt: new Date() },
      });
    }

    return { verified };
  }

  async toggleEnforcement({
    id,
    organizationId,
    ssoEnforced,
  }: {
    id: string;
    organizationId: string;
    ssoEnforced: boolean;
  }): Promise<SsoConnection> {
    return this.repository.update({
      id,
      organizationId,
      data: { ssoEnforced },
    });
  }

  async logScimRequest({
    organizationId,
    requestMethod,
    requestPath,
    responseStatus,
    durationMs,
    identityProvider,
  }: {
    organizationId: string;
    requestMethod: string;
    requestPath: string;
    responseStatus: number;
    durationMs: number;
    identityProvider: string | null;
  }): Promise<void> {
    await this.scimLogRepository.create({
      organizationId,
      requestMethod,
      requestPath,
      responseStatus,
      durationMs,
      identityProvider,
    });
  }

  async listScimLogs({
    organizationId,
    statusFilter,
    pathSearch,
    cursor,
    limit,
  }: {
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
    const result = await this.scimLogRepository.findByOrganization({
      organizationId,
      statusFilter,
      pathSearch,
      cursor,
      limit,
    });

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
}
