import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  AvatarValidationError,
  buildAvatarUrl,
  parseAvatarDataUrl,
} from "../avatar";

// A 1x1 transparent PNG, base64 — smallest valid real image payload.
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_1x1_DATA_URL = `data:image/png;base64,${PNG_1x1_BASE64}`;

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
    it("throws an invalid_data_url validation error", () => {
      expect(() => parseAvatarDataUrl("https://example.com/photo.png")).toThrow(
        AvatarValidationError,
      );
      try {
        parseAvatarDataUrl("not a data url");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe("invalid_data_url");
      }
    });
  });

  describe("when the image type is not allowed", () => {
    it("throws an invalid_type validation error", () => {
      try {
        parseAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AvatarValidationError);
        expect((err as AvatarValidationError).code).toBe("invalid_type");
      }
    });
  });

  describe("when the decoded payload is empty", () => {
    it("throws an empty validation error", () => {
      try {
        parseAvatarDataUrl("data:image/png;base64,");
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe("empty");
      }
    });
  });

  describe("when the payload exceeds the maximum size", () => {
    it("throws a file_too_large validation error", () => {
      const tooBig = Buffer.alloc(AVATAR_MAX_BYTES + 1, 0).toString("base64");
      try {
        parseAvatarDataUrl(`data:image/png;base64,${tooBig}`);
        throw new Error("expected parseAvatarDataUrl to throw");
      } catch (err) {
        expect((err as AvatarValidationError).code).toBe("file_too_large");
      }
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
