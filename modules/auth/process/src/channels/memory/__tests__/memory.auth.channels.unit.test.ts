/** @see specs/settings/change-password-auth0.feature */
import type { NotificationService } from "@langwatch/notification-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAuthChannels } from "../memory.auth.channels.ts";

describe("the memory tier's Auth0 password channel", () => {
  describe("when a password change reaches it", () => {
    it("answers not_configured, as a deployment naming no tenant does", async () => {
      const { auth0Passwords } = MemoryAuthChannels.create({
        bound: { notifications: createApiFixture<NotificationService>() },
      });
      const change = {
        email: "sam@acme.com",
        auth0UserId: "auth0|123",
        currentPassword: "old-password",
        newPassword: "a-new-password",
      };

      await expect(auth0Passwords.changePassword(change)).resolves.toEqual({
        outcome: "not_configured",
      });
    });
  });
});
