import type { OrganizationService } from "@langwatch/organization-contract";
import type { UserService as UserServiceContract } from "@langwatch/user-contract";
import type { UserAvatarStoragePort } from "../ports/user.port";
import { PrismaUserRepository } from "../repositories/prisma/prisma.user.repository";
import type { UserDatabase } from "../repositories/prisma/prisma.user.repository";
import { UserService } from "../services/user.service";

export interface PostgresUserAdapterOptions {
  database: UserDatabase;
  credentialIssuer: string;
  organizations: OrganizationService;
  avatarStorage: UserAvatarStoragePort;
  now?: () => Date;
}

export class PostgresUserAdapter {
  private constructor(private readonly options: PostgresUserAdapterOptions) {}

  static create(options: PostgresUserAdapterOptions): PostgresUserAdapter {
    return new PostgresUserAdapter(options);
  }

  build(): UserServiceContract {
    return UserService.create({
      repository: PrismaUserRepository.create(this.options.database, this.options.credentialIssuer),
      organizations: this.options.organizations,
      avatarStorage: this.options.avatarStorage,
      now: this.options.now,
    });
  }
}
