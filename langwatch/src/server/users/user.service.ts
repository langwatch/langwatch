import type { PrismaClient, User } from "@prisma/client";

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): UserService {
    return new UserService(prisma);
  }

  async findById({ id }: { id: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail({ email }: { email: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create({ name, email }: { name: string; email: string }): Promise<User> {
    return this.prisma.user.create({ data: { name, email } });
  }

  async updateProfile({ id, name, email }: { id: string; name?: string; email?: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
      },
    });
  }

  async deactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } });
  }

  async reactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { deactivatedAt: null } });
  }
}
