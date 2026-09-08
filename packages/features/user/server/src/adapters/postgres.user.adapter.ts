import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService as UserServiceContract } from "@langwatch/user-contract";
import type { UserAvatarStoragePort } from "../ports/user.port.ts";
import { PrismaUserRepository } from "../repositories/prisma/prisma.user.repository.ts";
import { UserService } from "../services/user.service.ts";

/**
 * The user directory, for a process that composes it BEFORE it boots a runtime.
 *
 * The API's browser-session boundary is one: Better Auth resolves a signed-in
 * person through this service, and it is built before the application graph the
 * feature installer belongs to. Every other caller reaches the same behaviour
 * through `UserApi`, which the installer provides over the same repository.
 */
export interface PostgresUserAdapterOptions {
  database: PrismaClient;
  credentialIssuer: string;
  organizations: OrganizationApi;
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
      repository: PrismaUserRepository.create({ prisma: this.options.database }),
      organizations: this.options.organizations,
      avatarStorage: this.options.avatarStorage,
      credentialIssuer: this.options.credentialIssuer,
      ...(this.options.now ? { now: this.options.now } : {}),
    });
  }
}
