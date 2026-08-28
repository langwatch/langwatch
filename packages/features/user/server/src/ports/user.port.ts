import type { UserAvatarMediaType } from "@langwatch/user-contract";

export abstract class UserAvatarStoragePort {
  abstract store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;
}
