/**
 * Which avatar reads the door may serve; every other one earns the same refusal.
 * Spec: specs/settings/user-avatar-upload.feature
 */
import type { UserAvatarObjectRead } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { isServableUserAvatar } from "../user-avatar-read.rules.ts";

function metadata(overrides: { purpose?: string; ownerKind?: string } = {}) {
  return {
    byteLength: 3,
    mediaType: "image/png",
    purpose: overrides.purpose ?? "user_avatar",
    ownerKind: overrides.ownerKind ?? "user",
  };
}

function available(overrides: { purpose?: string; ownerKind?: string } = {}): UserAvatarObjectRead {
  return { status: "available", metadata: metadata(overrides), stream: new ReadableStream() };
}

describe("isServableUserAvatar", () => {
  describe("when the object's purpose and owner kind are the avatar ones", () => {
    /** @scenario The avatar route serves an object whose purpose and owner kind are the avatar ones */
    it("serves it", () => {
      expect(isServableUserAvatar(available())).toBe(true);
    });
  });

  describe("when the object carries a purpose that is not the avatar one", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses it", () => {
      expect(isServableUserAvatar(available({ purpose: "trace_content" }))).toBe(false);
    });
  });

  describe("when the object is tagged as an avatar but was produced by a span", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses on the owner kind, so a forged purpose alone opens nothing", () => {
      expect(isServableUserAvatar(available({ ownerKind: "span" }))).toBe(false);
    });
  });

  describe("when there is no object at all", () => {
    /** @scenario "A URL with no avatar behind it is refused the same way as a foreign object" */
    it("refuses it", () => {
      expect(isServableUserAvatar(null)).toBe(false);
    });
  });

  describe("when the row is an avatar but its bytes are gone", () => {
    /** @scenario "A URL with no avatar behind it is refused the same way as a foreign object" */
    it("refuses it rather than confirming the id exists", () => {
      expect(isServableUserAvatar({ status: "missing", metadata: metadata() })).toBe(false);
    });
  });
});
