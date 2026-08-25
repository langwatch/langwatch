import type { UserAvatarMediaType } from "@langwatch/user-contract";

export abstract class UserSessionRevocationPort {
  abstract revokeForUser(input: { userId: string }): Promise<void>;
}

export abstract class UserCliTokenRevocationPort {
  abstract revokeForUser(input: { userId: string }): Promise<void>;
}

export abstract class UserAvatarStoragePort {
  abstract store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;
}
