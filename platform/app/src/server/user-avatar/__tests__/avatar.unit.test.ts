import { describe, expect, it } from "vitest";
import {
  AVATAR_ALLOWED_MEDIA_TYPES,
  AVATAR_MAX_BYTES,
  AvatarValidationError,
  buildAvatarUrl,
  parseAvatarDataUrl,
  safeAvatarMediaType,
} from "../avatar";

// A 1x1 transparent PNG, base64 — smallest valid real image payload.
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_1x1_DATA_URL = `data:image/png;base64,${PNG_1x1_BASE64}`;

// Minimal buffers carrying only each format's magic-byte signature — enough
// to exercise MAGIC_BYTE_CHECKS without needing a fully valid, decodable image.
const JPEG_MAGIC_BYTES_DATA_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64")}`;
const GIF_MAGIC_BYTES_DATA_URL = `data:image/gif;base64,${Buffer.from("GIF89a", "latin1").toString("base64")}`;
const WEBP_MAGIC_BYTES_DATA_URL = `data:image/webp;base64,${Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
]).toString("base64")}`;

describe("parseAvatarDataUrl", () => {
  describe("given a valid PNG data URL", () => {
    it("returns the decoded bytes and media type", () => {
      const { mediaType, bytes } = parseAvatarDataUrl(PNG_1x1_DATA_URL);
      expect(mediaType).toBe("image/png");
      expect(bytes.length).toBeGreaterThan(0);
      // PNG magic number.
      expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
    });
  });

  describe("given a media type with different casing", () => {
    it("normalizes the media type to lowercase", () => {
      const { mediaType } = parseAvatarDataUrl(
        `data:IMAGE/PNG;base64,${PNG_1x1_BASE64}`,
      );
      expect(mediaType).toBe("image/png");
    });
  });

  describe("when the string is not a base64 image data URL", () => {
    /** @scenario The server refuses a payload it cannot read as an image */
    it("throws avatar_image_unreadable with an invalid_data_url reason", () => {
      expect(() => parseAvatarDataUrl("https://example.com/photo.png")).toThrow(
        AvatarValidationError,
      );
      try {
        parseAvatarDataUrl("not a data url");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_unreadable",
        );
        expect((err as AvatarValidationError).meta).toMatchObject({
          reason: "invalid_data_url",
        });
      }
    });
  });

  describe("when the image type is not allowed", () => {
    /** @scenario The server refuses an image type it does not accept */
    it("throws avatar_image_type_unsupported", () => {
      try {
        parseAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AvatarValidationError);
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_type_unsupported",
        );
      }
    });
  });

  describe("when the decoded payload is empty", () => {
    it("throws avatar_image_unreadable with an empty reason", () => {
      try {
        parseAvatarDataUrl("data:image/png;base64,");
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_unreadable",
        );
        expect((err as AvatarValidationError).meta).toMatchObject({
          reason: "empty",
        });
      }
    });
  });

  describe("when the payload exceeds the maximum size", () => {
    it("throws avatar_image_too_large", () => {
      const tooBig = Buffer.alloc(AVATAR_MAX_BYTES + 1, 0).toString("base64");
      try {
        parseAvatarDataUrl(`data:image/png;base64,${tooBig}`);
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_too_large",
        );
      }
    });
  });

  describe("given content whose magic bytes match the declared type", () => {
    it.each([
      ["image/jpeg", JPEG_MAGIC_BYTES_DATA_URL],
      ["image/gif", GIF_MAGIC_BYTES_DATA_URL],
      ["image/webp", WEBP_MAGIC_BYTES_DATA_URL],
    ])("accepts a %s payload", (mediaType, dataUrl) => {
      const result = parseAvatarDataUrl(dataUrl);
      expect(result.mediaType).toBe(mediaType);
    });
  });

  describe("when the decoded bytes don't match the declared type", () => {
    /** @scenario Bytes that contradict the declared image type are refused as unusable */
    it("throws a content_mismatch validation error for non-image bytes", () => {
      const plainTextAsPng = `data:image/png;base64,${Buffer.from(
        "hello world, this is not an image",
      ).toString("base64")}`;
      try {
        parseAvatarDataUrl(plainTextAsPng);
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AvatarValidationError);
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_unreadable",
        );
        expect((err as AvatarValidationError).meta).toMatchObject({
          reason: "content_mismatch",
        });
      }
    });

    it("throws a content_mismatch validation error for a real image of a different type", () => {
      // Real PNG bytes declared as image/jpeg — the signature doesn't match.
      const pngDeclaredAsJpeg = `data:image/jpeg;base64,${PNG_1x1_BASE64}`;
      try {
        parseAvatarDataUrl(pngDeclaredAsJpeg);
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe(
          "avatar_image_unreadable",
        );
        expect((err as AvatarValidationError).meta).toMatchObject({
          reason: "content_mismatch",
        });
      }
    });
  });
});

describe("safeAvatarMediaType", () => {
  describe("given a media type in the avatar allowlist", () => {
    it.each(AVATAR_ALLOWED_MEDIA_TYPES)("returns %s unchanged", (mediaType) => {
      expect(safeAvatarMediaType(mediaType)).toBe(mediaType);
    });
  });

  describe("given a media type outside the avatar allowlist", () => {
    it("coerces image/svg+xml to application/octet-stream even though it is image/*", () => {
      // The general stored-objects allowlist (isReadbackSafe) passes the whole
      // image/ family, including svg+xml; this route pins to the narrower
      // avatar-specific list regardless of that broader allowlist.
      expect(safeAvatarMediaType("image/svg+xml")).toBe(
        "application/octet-stream",
      );
    });

    it("coerces a non-image type to application/octet-stream", () => {
      expect(safeAvatarMediaType("text/html")).toBe("application/octet-stream");
    });
  });
});

describe("buildAvatarUrl", () => {
  describe("given a project id and stored-object id", () => {
    it("builds the same-origin user-avatar serve path", () => {
      expect(buildAvatarUrl({ projectId: "proj_1", id: "so_abc" })).toBe(
        "/api/user-avatar/proj_1/so_abc",
      );
    });
  });
});
