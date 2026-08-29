import { USER_AVATAR_MAX_BYTES, UserAvatarValidationError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { safeUserAvatarMediaType } from "@langwatch/user-contract";
import { UserAvatarCodec } from "../user-avatar.service";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("user avatar validation", () => {
  const avatars = UserAvatarCodec.create();

  it("decodes an allowed image whose signature matches", () => {
    expect(avatars.parse(`data:image/png;base64,${PNG_BASE64}`).mediaType).toBe("image/png");
  });

  it("refuses active or mislabeled content", () => {
    expect(() => avatars.parse("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toThrow(
      UserAvatarValidationError,
    );
    expect(() => avatars.parse(`data:image/jpeg;base64,${PNG_BASE64}`)).toThrow(
      UserAvatarValidationError,
    );
  });

  it("refuses decoded payloads over the byte ceiling", () => {
    const encoded = Buffer.alloc(USER_AVATAR_MAX_BYTES + 1).toString("base64");
    expect(() => avatars.parse(`data:image/png;base64,${encoded}`)).toThrow(
      UserAvatarValidationError,
    );
  });

  it("keeps delivery content types on the avatar allowlist", () => {
    expect(safeUserAvatarMediaType("image/png")).toBe("image/png");
    expect(safeUserAvatarMediaType("image/svg+xml")).toBe("application/octet-stream");
  });

  it("builds the existing same-origin delivery path", () => {
    expect(avatars.buildUrl({ projectId: "project-1", id: "object-1" })).toBe(
      "/api/user-avatar/project-1/object-1",
    );
  });
});
