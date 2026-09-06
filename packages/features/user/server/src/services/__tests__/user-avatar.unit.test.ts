import {
  USER_AVATAR_ALLOWED_MEDIA_TYPES,
  USER_AVATAR_MAX_BYTES,
  UserAvatarValidationError,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { safeUserAvatarMediaType } from "@langwatch/user-contract";
import { UserAvatarCodecService } from "../user-avatar.service";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("user avatar validation", () => {
  const avatars = UserAvatarCodecService.create();

  it("decodes an allowed image whose signature matches", () => {
    expect(avatars.parse(`data:image/png;base64,${PNG_BASE64}`).mediaType).toBe("image/png");
  });

  /** @scenario "A non-image file is rejected" */
  it("refuses active or mislabeled content", () => {
    expect(() => avatars.parse("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toThrow(
      UserAvatarValidationError,
    );
    expect(() => avatars.parse(`data:image/jpeg;base64,${PNG_BASE64}`)).toThrow(
      UserAvatarValidationError,
    );
  });

  /** @scenario "An oversized image is rejected" */
  /** @scenario "The server refuses an oversized payload with the same reason as the browser" */
  it("refuses decoded payloads over the byte ceiling", () => {
    const encoded = Buffer.alloc(USER_AVATAR_MAX_BYTES + 1).toString("base64");
    expect(() => avatars.parse(`data:image/png;base64,${encoded}`)).toThrow(
      UserAvatarValidationError,
    );
    expect(() => avatars.parse(`data:image/png;base64,${encoded}`)).toThrow(
      expect.objectContaining({ code: "avatar_image_too_large" }),
    );
  });

  describe("when the payload declares a type outside the accepted list", () => {
    /** @scenario "The server refuses an image type it does not accept" */
    it("names the unsupported type and the types it does accept", () => {
      expect(() => avatars.parse("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toThrow(
        expect.objectContaining({
          code: "avatar_image_type_unsupported",
          meta: expect.objectContaining({ allowed: [...USER_AVATAR_ALLOWED_MEDIA_TYPES] }),
        }),
      );
    });
  });

  describe("when the payload is not a readable image at all", () => {
    /** @scenario "The server refuses a payload it cannot read as an image" */
    it("records why it was unreadable", () => {
      expect(() => avatars.parse("https://example.com/photo.png")).toThrow(
        expect.objectContaining({
          code: "avatar_image_unreadable",
          meta: expect.objectContaining({ reason: "invalid_data_url" }),
        }),
      );
      expect(() => avatars.parse("data:image/png;base64,")).toThrow(
        expect.objectContaining({
          code: "avatar_image_unreadable",
          meta: expect.objectContaining({ reason: "empty" }),
        }),
      );
    });
  });

  describe("when the bytes contradict the declared type", () => {
    /** @scenario "Bytes that contradict the declared image type are refused as unusable" */
    it("refuses text dressed as an image and an image dressed as another type", () => {
      const textAsPng = `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}`;

      expect(() => avatars.parse(textAsPng)).toThrow(
        expect.objectContaining({
          code: "avatar_image_unreadable",
          meta: expect.objectContaining({ reason: "content_mismatch" }),
        }),
      );
      expect(() => avatars.parse(`data:image/jpeg;base64,${PNG_BASE64}`)).toThrow(
        expect.objectContaining({
          code: "avatar_image_unreadable",
          meta: expect.objectContaining({ reason: "content_mismatch" }),
        }),
      );
    });
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
