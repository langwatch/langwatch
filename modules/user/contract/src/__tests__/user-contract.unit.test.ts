import { describe, expect, it } from "vitest";

import {
  USER_AVATAR_MAX_DATA_URL_LENGTH,
  setFirstUserPasswordInputSchema,
  setFirstUserPasswordResultSchema,
  setUserAvatarInputSchema,
  userPasskeyNudgeStatusSchema,
  userProfileSchema,
} from "../index.ts";

describe("user contract", () => {
  it("accepts portable user profiles", () => {
    expect(
      userProfileSchema.parse({
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
      }).id,
    ).toBe("user-1");
  });

  it("does not duplicate the byte ceiling in the transport schema", () => {
    expect(
      setUserAvatarInputSchema.validate({
        userId: "user-1",
        organizationId: "org-1",
        imageDataUrl: "x".repeat(USER_AVATAR_MAX_DATA_URL_LENGTH + 1),
      }),
    ).toBe(true);
  });

  it("keeps first-password input portable and explicit", () => {
    expect(setFirstUserPasswordInputSchema.validate({ id: "user-1", passwordHash: "" })).toBe(
      false,
    );
    expect(setFirstUserPasswordResultSchema.validate("overwritten")).toBe(false);
  });

  it("keeps passkey-nudge status portable", () => {
    const dismissedAt = new Date(0);
    expect(
      userPasskeyNudgeStatusSchema.parse({ hasPasskey: false, twoStepEnabled: false, dismissedAt }),
    ).toEqual({
      hasPasskey: false,
      twoStepEnabled: false,
      dismissedAt,
    });
  });
});
