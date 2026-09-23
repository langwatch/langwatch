/**
 * The shape `user.updateName` accepts. The screen stands Save down on a blank
 * name, but the boundary refuses one on its own. Spec: specs/settings/profile.feature
 */
import { describe, expect, it } from "vitest";

import { userApiUpdateNameInputSchema } from "../user.schemas.ts";
import { userProfileNameSchema } from "../user.ts";

describe("given a display name at the boundary", () => {
  describe("when it is whitespace", () => {
    /** @scenario A blank name is refused at the boundary as well */
    it("is refused rather than trimmed down to nothing and stored", () => {
      expect(userProfileNameSchema.safeParse("   ").success).toBe(false);
      expect(userProfileNameSchema.safeParse("").success).toBe(false);
      expect(userProfileNameSchema.safeParse("\t\n").success).toBe(false);
      expect(userApiUpdateNameInputSchema.safeParse({ name: "  " }).success).toBe(false);
    });
  });

  describe("when it has something in it", () => {
    it("keeps the name without the padding around it", () => {
      expect(userApiUpdateNameInputSchema.parse({ name: "  Ana Silva  " })).toEqual({
        name: "Ana Silva",
      });
    });
  });

  describe("when it runs past what a member list can carry", () => {
    it("is refused rather than truncated behind the reader's back", () => {
      expect(userProfileNameSchema.safeParse("a".repeat(121)).success).toBe(false);
      expect(userProfileNameSchema.safeParse("a".repeat(120)).success).toBe(true);
    });
  });
});
