import {
  USER_AVATAR_ALLOWED_MEDIA_TYPES,
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_MAX_DATA_URL_LENGTH,
  UserAvatarTooLargeError,
  UserAvatarTypeUnsupportedError,
  UserAvatarUnreadableError,
  type UserAvatarMediaType,
} from "@langwatch/user-contract";

const DATA_URL_PATTERN =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/iu;

const SIGNATURES: Record<
  UserAvatarMediaType,
  (bytes: Uint8Array) => boolean
> = {
  "image/png": (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  "image/jpeg": (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  "image/gif": (bytes) => {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("latin1");
    return header === "GIF87a" || header === "GIF89a";
  },
  "image/webp": (bytes) =>
    Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP",
};

export class UserAvatarCodec {
  private constructor() {}

  static create(): UserAvatarCodec {
    return new UserAvatarCodec();
  }

  parse(dataUrl: string): {
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  } {
    const trimmed = dataUrl.trim();
    if (trimmed.length > USER_AVATAR_MAX_DATA_URL_LENGTH) {
      throw new UserAvatarTooLargeError();
    }
    const match = DATA_URL_PATTERN.exec(trimmed);
    if (!match) {
      throw new UserAvatarUnreadableError(
        "invalid_data_url",
        "Avatar payload is not a base64 image data URL",
      );
    }
    const mediaType = match[1]!.toLowerCase();
    if (!this.isAllowedMediaType(mediaType)) {
      throw new UserAvatarTypeUnsupportedError(mediaType);
    }
    const bytes = Buffer.from(match[2]!.replace(/\s+/gu, ""), "base64");
    if (bytes.length === 0) {
      throw new UserAvatarUnreadableError(
        "empty",
        "Avatar payload decoded to zero bytes",
      );
    }
    if (bytes.length > USER_AVATAR_MAX_BYTES) {
      throw new UserAvatarTooLargeError();
    }
    if (!SIGNATURES[mediaType](bytes)) {
      throw new UserAvatarUnreadableError(
        "content_mismatch",
        `Avatar bytes do not match the declared media type: ${mediaType}`,
      );
    }
    return { mediaType, bytes };
  }

  buildUrl(input: { projectId: string; id: string }): string {
    return `/api/user-avatar/${encodeURIComponent(input.projectId)}/${encodeURIComponent(input.id)}`;
  }

  private isAllowedMediaType(
    mediaType: string,
  ): mediaType is UserAvatarMediaType {
    return (USER_AVATAR_ALLOWED_MEDIA_TYPES as readonly string[]).includes(
      mediaType,
    );
  }
}
