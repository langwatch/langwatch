import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { StoredObjectService } from "@langwatch/stored-object-contract";
import {
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  type UserAvatarMediaType,
  type UserService,
} from "@langwatch/user-contract";
import { PostgresUserAdapter, UserAvatarStoragePort } from "@langwatch/user-server";
import type { PrismaClient } from "~/generated/prisma/client";

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
    organizations: OrganizationService;
    storedObjects: StoredObjectService;
  }): UserService {
    return PostgresUserAdapter.create({
      database: options.database,
      credentialIssuer: issuerForProviderId("credential"),
      organizations: options.organizations,
      avatarStorage: AppUserAvatarStorageAdapter.create(options.storedObjects),
    }).build();
  }
}
