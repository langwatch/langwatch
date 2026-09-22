// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient, ScimUserResource } from "~/generated/prisma/client";

import { assertScimOrganizationId } from "./scim-organization-scope";

export class ScimUserResourceRepository {
  readonly #prisma: PrismaClient;

  private constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  static create(prisma: PrismaClient): ScimUserResourceRepository {
    return new ScimUserResourceRepository(prisma);
  }

  find(
    organizationId: string,
    userId: string,
  ): Promise<ScimUserResource | null> {
    assertScimOrganizationId(organizationId);
    return this.#prisma.scimUserResource.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  async findUserByName(organizationId: string, userName: string) {
    assertScimOrganizationId(organizationId);
    const resource = await this.#prisma.scimUserResource.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        userName: { equals: userName.trim(), mode: "insensitive" },
      },
      include: { user: true },
    });
    return resource?.user ?? null;
  }

  async hasLegacyNameConflict(
    organizationId: string,
    userId: string | undefined,
    userName: string,
  ): Promise<boolean> {
    assertScimOrganizationId(organizationId);
    const holder = await this.#prisma.user.findFirst({
      where: {
        ...(userId === void 0 ? {} : { id: { not: userId } }),
        orgMemberships: { some: { organizationId } },
        scimUserResources: { none: { organizationId } },
        email: { equals: userName.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    return holder !== null;
  }

  save(input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }): Promise<ScimUserResource> {
    assertScimOrganizationId(input.organizationId);
    const data = {
      ...input,
      userName: input.userName.trim().toLowerCase(),
      deletedAt: null,
    };
    return this.#prisma.scimUserResource.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
      create: data,
      update: {
        userName: data.userName,
        name: data.name,
        active: data.active,
        deletedAt: null,
      },
    });
  }

  async markDeleted(input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
  }): Promise<void> {
    assertScimOrganizationId(input.organizationId);
    const deletedAt = new Date();
    await this.#prisma.scimUserResource.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
      create: { ...input, active: false, deletedAt },
      update: { active: false, deletedAt },
    });
  }
}
