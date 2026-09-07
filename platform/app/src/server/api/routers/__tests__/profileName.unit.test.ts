/**
 * The shape `user.updateName` accepts.
 *
 * The screen stands its Save button down on a blank name, but the screen is
 * never the authority: a blank persisted here would render as an unexplained
 * gap in every member list, every comment and every audit entry, so the
 * boundary refuses it on its own.
 *
 * Spec: specs/settings/profile.feature
 */
import { describe, expect, it } from "vitest";
import { PROFILE_NAME_SCHEMA } from "../user";

describe("given a display name at the boundary", () => {
  describe("when it is whitespace", () => {
    /** @scenario A blank name is refused at the boundary as well */
    it("is refused rather than trimmed down to nothing and stored", () => {
      expect(PROFILE_NAME_SCHEMA.safeParse("   ").success).toBe(false);
      expect(PROFILE_NAME_SCHEMA.safeParse("").success).toBe(false);
      expect(PROFILE_NAME_SCHEMA.safeParse("\t\n").success).toBe(false);
    });
  });

  describe("when it has something in it", () => {
    it("keeps the name without the padding around it", () => {
      const parsed = PROFILE_NAME_SCHEMA.parse("  Ana Silva  ");

      expect(parsed).toBe("Ana Silva");
    });
  });

  describe("when it runs past what a member list can carry", () => {
    it("is refused rather than truncated behind the reader's back", () => {
      expect(PROFILE_NAME_SCHEMA.safeParse("a".repeat(121)).success).toBe(
        false,
      );
      expect(PROFILE_NAME_SCHEMA.safeParse("a".repeat(120)).success).toBe(true);
    });
  });
});
