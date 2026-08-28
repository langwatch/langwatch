import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { StoredObjectService } from "@langwatch/stored-object-contract";
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

class AppUserSessionRevocationAdapter extends UserSessionRevocationPort {
  static create(
    database: PrismaClient,
    redis: RedisConnection | null,
  ): AppUserSessionRevocationAdapter {
    return new AppUserSessionRevocationAdapter(database, redis);
  }

  private constructor(
    private readonly database: PrismaClient,
    private readonly redis: RedisConnection | null,
  ) {
    super();
  }

  revokeForUser(input: { userId: string }): Promise<void> {
    return revokeAllSessionsForUser({
      prisma: this.database,
      redis: this.redis,
      userId: input.userId,
    });
  }
}

class AppUserCliTokenRevocationAdapter extends UserCliTokenRevocationPort {
  static create(governance: GovernanceService): AppUserCliTokenRevocationAdapter {
    return new AppUserCliTokenRevocationAdapter(governance);
  }

  private constructor(private readonly governance: GovernanceService) {
    super();
  }

  async revokeForUser(input: { userId: string }): Promise<void> {
    await this.governance.cliTokenRevokeForUser(input);
  }
}

class AppUserAvatarStorageAdapter extends UserAvatarStoragePort {
  static create(storedObjects: StoredObjectService): AppUserAvatarStorageAdapter {
    return new AppUserAvatarStorageAdapter(storedObjects);
  }

  private constructor(private readonly storedObjects: StoredObjectService) {
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
      filename: "avatar",
      mediaType: input.mediaType,
      audience: "project:view",
      bytes: input.bytes,
    });
    return { id: stored.reference.id };
  }
}

/** Process composition for the User feature's canonical service. */
export class AppUserRuntimeAdapter {
  private constructor() {}

  static create(options: {
    database: PrismaClient;
    redis: RedisConnection | null;
    organizations: OrganizationService;
    governance: GovernanceService;
    storedObjects: StoredObjectService;
  }): UserService {
    return PostgresUserAdapter.create({
      database: options.database,
      sessions: AppUserSessionRevocationAdapter.create(options.database, options.redis),
      cliTokens: AppUserCliTokenRevocationAdapter.create(options.governance),
      organizations: options.organizations,
      avatarStorage: AppUserAvatarStorageAdapter.create(options.storedObjects),
    }).build();
  }
}
