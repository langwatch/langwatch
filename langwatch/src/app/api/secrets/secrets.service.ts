import type { PrismaClient } from "@prisma/client";
import { SecretsRepository } from "./secrets.repository";
import { encrypt } from "~/utils/encryption";

const MAX_SECRETS_PER_PROJECT = 50;

type SecretResponse = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

function toResponse(s: {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): SecretResponse {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export class SecretsService {
  private readonly repo: SecretsRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new SecretsRepository(prisma);
  }

  async getAll({ projectId }: { projectId: string }): Promise<SecretResponse[]> {
    const secrets = await this.repo.findAllByProject({ projectId });
    return secrets.map(toResponse);
  }

  async getById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<SecretResponse | null> {
    const secret = await this.repo.findByIdInProject({ id, projectId });
    return secret ? toResponse(secret) : null;
  }

  async create({
    projectId,
    teamId,
    name,
    value,
  }: {
    projectId: string;
    teamId: string;
    name: string;
    value: string;
  }): Promise<{ secret: SecretResponse } | { error: string; status: 409 | 422 }> {
    const count = await this.repo.countByProject({ projectId });
    if (count >= MAX_SECRETS_PER_PROJECT) {
      return {
        error: `Maximum of ${MAX_SECRETS_PER_PROJECT} secrets per project reached`,
        status: 422,
      };
    }

    const existing = await this.repo.findByNameInProject({ name, projectId });
    if (existing) {
      return {
        error: `A secret with the name "${name}" already exists`,
        status: 409,
      };
    }

    const encryptedValue = encrypt(value);
    const userId = (await this.repo.findFallbackOwner({ teamId })) ?? "system";

    const secret = await this.repo.create({
      projectId,
      name,
      encryptedValue,
      userId,
    });

    return { secret: toResponse(secret) };
  }

  async update({
    id,
    projectId,
    value,
  }: {
    id: string;
    projectId: string;
    value: string;
  }): Promise<SecretResponse | null> {
    const existing = await this.repo.findByIdInProject({ id, projectId });
    if (!existing) return null;

    const encryptedValue = encrypt(value);
    const secret = await this.repo.update({ id, projectId, encryptedValue });
    return toResponse(secret);
  }

  async delete({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<boolean> {
    const existing = await this.repo.findByIdInProject({ id, projectId });
    if (!existing) return false;

    await this.repo.delete({ id, projectId });
    return true;
  }
}
