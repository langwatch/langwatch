/**
 * Data-access for VirtualKey. Every caller must pass `projectId` — the
 * multitenancy middleware rejects queries without it.
 */
import type {
  Prisma,
  PrismaClient,
  VirtualKey,
  VirtualKeyProviderCredential,
} from "@prisma/client";

export type VirtualKeyWithChain = VirtualKey & {
  providerCredentials: VirtualKeyProviderCredential[];
};

export type CreateVirtualKeyData = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  environment: "LIVE" | "TEST";
  hashedSecret: string;
  displayPrefix: string;
  principalUserId?: string | null;
  config: Prisma.InputJsonValue;
  createdById: string;
  providerCredentialIds: { id: string; priority: number }[];
};

export class VirtualKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findFirst({
      where: { id, projectId },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async findByIdGlobal(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findUnique({
      where: { id },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async findByHashedSecret(
    hashedSecret: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findFirst({
      where: {
        OR: [
          { hashedSecret },
          {
            previousHashedSecret: hashedSecret,
            previousSecretValidUntil: { gt: new Date() },
          },
        ],
      },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async findAll(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain[]> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findMany({
      where: { projectId },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    data: CreateVirtualKeyData,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain> {
    const client = tx ?? this.prisma;
    return client.virtualKey.create({
      data: {
        id: data.id,
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        environment: data.environment,
        hashedSecret: data.hashedSecret,
        displayPrefix: data.displayPrefix,
        principalUserId: data.principalUserId ?? null,
        config: data.config,
        createdById: data.createdById,
        revision: 1n,
        providerCredentials: {
          create: data.providerCredentialIds.map(({ id, priority }) => ({
            providerCredentialId: id,
            priority,
          })),
        },
      },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async updateConfig(
    id: string,
    projectId: string,
    config: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, projectId },
      data: { config, revision: { increment: 1n } },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async replaceProviderChain(
    id: string,
    providerCredentialIds: { id: string; priority: number }[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.virtualKeyProviderCredential.deleteMany({
      where: { virtualKeyId: id },
    });
    await client.virtualKeyProviderCredential.createMany({
      data: providerCredentialIds.map(({ id: credId, priority }) => ({
        virtualKeyId: id,
        providerCredentialId: credId,
        priority,
      })),
    });
  }

  async rotateSecret(
    id: string,
    projectId: string,
    newHashedSecret: string,
    newDisplayPrefix: string,
    previousHashedSecret: string,
    previousSecretValidUntil: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, projectId },
      data: {
        hashedSecret: newHashedSecret,
        displayPrefix: newDisplayPrefix,
        previousHashedSecret,
        previousSecretValidUntil,
        revision: { increment: 1n },
      },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async revoke(
    id: string,
    projectId: string,
    revokedById: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithChain> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, projectId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedById,
        previousHashedSecret: null,
        previousSecretValidUntil: null,
        revision: { increment: 1n },
      },
      include: { providerCredentials: { orderBy: { priority: "asc" } } },
    });
  }

  async recordUsage(
    id: string,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.virtualKey.update({
      where: { id },
      data: { lastUsedAt: at },
    });
  }
}
