import type { GovernanceCliTokenRevocationService } from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  type UserAvatarMediaType,
  type UserService,
} from "@langwatch/user-contract";
import {
  PostgresUserAdapter,
  UserAvatarStoragePort,
  UserCliTokenRevocationPort,
  UserSessionRevocationPort,
} from "@langwatch/user-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { revokeAllSessionsForUser } from "~/server/better-auth/revokeSessions";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";

class AppUserSessionRevocationPort extends UserSessionRevocationPort {
  private constructor(
    private readonly database: PrismaClient,
    private readonly redis: RedisConnection | null,
  ) {
    super();
  }

  static create(
    database: PrismaClient,
    redis: RedisConnection | null,
  ): AppUserSessionRevocationPort {
    return new AppUserSessionRevocationPort(database, redis);
  }

  revokeForUser(input: { userId: string }): Promise<void> {
    return revokeAllSessionsForUser({
      prisma: this.database,
      redis: this.redis,
      userId: input.userId,
    });
  }
}

class AppUserCliTokenRevocationPort extends UserCliTokenRevocationPort {
  private constructor(private readonly service: GovernanceCliTokenRevocationService) {
    super();
  }

  static create(
    service: GovernanceCliTokenRevocationService,
  ): AppUserCliTokenRevocationPort {
    return new AppUserCliTokenRevocationPort(service);
  }

  async revokeForUser(input: { userId: string }): Promise<void> {
    await this.service.revokeForUser(input);
  }
}

class AppUserAvatarStoragePort extends UserAvatarStoragePort {
  async store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const stored = await createStoredObjectsService({
      projectId: input.projectId,
    }).storeFromBytes({
      projectId: input.projectId,
      purpose: USER_AVATAR_PURPOSE,
      ownerKind: USER_AVATAR_OWNER_KIND,
      ownerId: input.userId,
      mediaType: input.mediaType,
      bytes: Buffer.from(input.bytes),
    });
    return { id: stored.id };
  }
}

export class AppUserRuntime {
  private constructor() {}

  static create(options: {
    database: PrismaClient;
    redis: RedisConnection | null;
    organizations: OrganizationService;
    cliTokenRevocation: GovernanceCliTokenRevocationService;
  }): UserService {
    return PostgresUserAdapter.create({
      database: options.database,
      sessions: AppUserSessionRevocationPort.create(options.database, options.redis),
      cliTokens: AppUserCliTokenRevocationPort.create(options.cliTokenRevocation),
      organizations: options.organizations,
      avatarStorage: new AppUserAvatarStoragePort(),
    }).build();
  }
}
