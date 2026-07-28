import type { PrismaClient } from "@prisma/client";
import { SecretsRepository } from "./secrets.repository";
import { encrypt } from "~/utils/encryption";
import { RESERVED_PROJECT_SECRET_NAMES } from "~/server/projects/reserved-secret-names";

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
    // Product-owned rows read as not-found, so a response never confirms the
    // reserved row exists. Mirrors the tRPC secrets router.
    if (!secret || RESERVED_PROJECT_SECRET_NAMES.includes(secret.name)) {
      return null;
    }
    return toResponse(secret);
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
    // The uppercase-only name schema can never produce a reserved (lowercase)
    // name today; this check pins the boundary rather than trusting that
    // disjointness to hold forever.
    if (RESERVED_PROJECT_SECRET_NAMES.includes(name)) {
      return { error: `The name "${name}" is reserved`, status: 422 };
    }

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
    // Reserved rows read as not-found: overwriting the Langy VK secret would
    // silently break the key the gateway authenticates against.
    if (!existing || RESERVED_PROJECT_SECRET_NAMES.includes(existing.name)) {
      return null;
    }

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
    // Reserved rows read as not-found: deleting the Langy VK secret breaks
    // the live key AND makes the next chat mint a duplicate VK, because the
    // row's presence is what marks the project as already provisioned.
    if (!existing || RESERVED_PROJECT_SECRET_NAMES.includes(existing.name)) {
      return false;
    }

    await this.repo.delete({ id, projectId });
    return true;
  }
}
