import { HandledError } from "@langwatch/handled-error";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import {
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserAvatarNotFoundError,
  type UserAvatarMediaType,
  type UserAvatarObjectRead,
} from "@langwatch/user-contract";

/** The deployment's delivery audience for an avatar: any viewer of the project it sits in. */
const AVATAR_AUDIENCE = "project:view";

/** Where an uploaded avatar's bytes go. */
export type UserAvatarStorage = Pick<UserAvatarObjectService, "store">;

type AvatarObjects = Pick<StoredObjectApi, "storeFromBytes" | "readById" | "getReadUrlForPurpose">;

/**
 * Main's avatar objects: bytes kept as a user-owned object in the uploader's personal project,
 * through stored-object. A read of a row that is not there answers nothing, and the avatar door
 * turns that into its one refusal.
 */
export class UserAvatarObjectService {
  static create({ storedObjects }: { storedObjects: AvatarObjects }): UserAvatarObjectService {
    return new UserAvatarObjectService(storedObjects);
  }

  private constructor(private readonly storedObjects: AvatarObjects) {}

  async store({
    projectId,
    userId,
    mediaType,
    bytes,
  }: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const { reference } = await this.storedObjects.storeFromBytes({
      projectId,
      filename: "avatar",
      mediaType,
      bytes,
      audience: AVATAR_AUDIENCE,
      purpose: USER_AVATAR_PURPOSE,
      ownerKind: USER_AVATAR_OWNER_KIND,
      ownerId: userId,
    });

    return { id: reference.id };
  }

  async findById(input: { projectId: string; id: string }): Promise<UserAvatarObjectRead> {
    const read = await this.storedObjects.readById(input).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "stored_object_not_found") return null;
      throw error;
    });
    if (!read) return null;

    const metadata = {
      byteLength: read.row.size_bytes,
      mediaType: read.row.media_type,
      purpose: read.row.purpose,
      ownerKind: read.row.owner_kind,
    };
    if ("status" in read) return { status: "missing", metadata };

    return { status: "available", metadata, stream: ReadableStream.from(read.stream) };
  }

  /** A signed read URL, only for an avatar object; `UserAvatarNotFoundError` otherwise. */
  getReadUrl(input: { projectId: string; id: string }): Promise<{ url: string }> {
    return this.storedObjects
      .getReadUrlForPurpose({
        ...input,
        purpose: USER_AVATAR_PURPOSE,
        ownerKind: USER_AVATAR_OWNER_KIND,
      })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "stored_object_not_found")
          throw new UserAvatarNotFoundError(input.id);
        throw error;
      });
  }
}
