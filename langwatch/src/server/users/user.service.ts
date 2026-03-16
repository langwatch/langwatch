import type { PrismaClient, User } from "@prisma/client";

/**
 * Service layer for User lifecycle management.
 * Framework-agnostic - no tRPC dependencies.
 */
export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating a UserService with proper DI.
   */
  static create(prisma: PrismaClient): UserService {
    return new UserService(prisma);
  }

  /**
   * Finds a user by their internal ID.
   */
  async findById({ id }: { id: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Finds a user by email address.
   */
  async findByEmail({ email }: { email: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Finds a user by SCIM externalId within an organization.
   * Joins through OrganizationUser to scope the lookup.
   */
  async findByExternalId({
    externalId,
    organizationId,
  }: {
    externalId: string;
    organizationId: string;
  }): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        externalId,
        orgMemberships: {
          some: { organizationId },
        },
      },
    });
    return user;
  }

  /**
   * Creates a new user.
   */
  async create({
    name,
    email,
    externalId,
  }: {
    name: string;
    email: string;
    externalId?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        name,
        email,
        externalId,
        scimProvisioned: !!externalId,
      },
    });
  }

  /**
   * Updates a user's profile fields (name and/or email).
   */
  async updateProfile({
    id,
    name,
    email,
  }: {
    id: string;
    name?: string;
    email?: string;
  }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
      },
    });
  }

  /**
   * Deactivates a user by setting deactivatedAt to the current timestamp.
   */
  async deactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: new Date() },
    });
  }

  /**
   * Reactivates a user by clearing deactivatedAt.
   */
  async reactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: null },
    });
  }

  /**
   * Sets the SCIM externalId on a user.
   */
  async setExternalId({
    id,
    externalId,
  }: {
    id: string;
    externalId: string;
  }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { externalId, scimProvisioned: true },
    });
  }
}
