import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
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
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";

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
  private constructor(private readonly governance: GovernanceService) {
    super();
  }

  static create(governance: GovernanceService): AppUserCliTokenRevocationPort {
    return new AppUserCliTokenRevocationPort(governance);
  }

  async revokeForUser(input: { userId: string }): Promise<void> {
    await this.governance.cliTokenRevokeForUser(input);
  }
}

class AppUserAvatarStoragePort extends UserAvatarStoragePort {
  constructor(private readonly storedObjects: StoredObjectsService) {
    super();
  }

  async store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const stored = await this.storedObjects.storeFromBytes({
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
    governance: GovernanceService;
    storedObjects: StoredObjectsService;
  }): UserService {
    return PostgresUserAdapter.create({
      database: options.database,
      sessions: AppUserSessionRevocationPort.create(options.database, options.redis),
      cliTokens: AppUserCliTokenRevocationPort.create(options.governance),
      organizations: options.organizations,
      avatarStorage: new AppUserAvatarStoragePort(options.storedObjects),
    }).build();
  }
}
