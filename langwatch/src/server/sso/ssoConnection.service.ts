import type { PrismaClient, SsoConnection } from "@prisma/client";
import { encrypt } from "../../utils/encryption";
import { SsoConnectionRepository } from "./ssoConnection.repository";

export class SsoConnectionService {
  private readonly repository: SsoConnectionRepository;

  constructor(prisma: PrismaClient) {
    this.repository = SsoConnectionRepository.create(prisma);
  }

  static create(prisma: PrismaClient): SsoConnectionService {
    return new SsoConnectionService(prisma);
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
    clientId: string;
    clientSecret: string;
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
    const clientSecretEnc = encrypt(clientSecret);

    return this.repository.create({
      organizationId,
      domain,
      provider,
      clientId,
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
      clientId?: string;
      clientSecret?: string;
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
        ...(clientSecret !== undefined
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
}
