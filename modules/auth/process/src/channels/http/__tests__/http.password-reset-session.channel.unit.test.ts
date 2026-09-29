/**
 * @vitest-environment node
 * @see specs/auth/password-reset.feature
 */
import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-auth/cookies", () => ({ setSessionCookie: vi.fn(async () => undefined) }));

import { setSessionCookie } from "better-auth/cookies";

import {
  PasswordResetSessionChannel,
  type PasswordResetEndpointContext,
} from "../http.password-reset-session.channel.ts";

function contextFor({
  request,
  path = "/reset-password",
  returned,
  user = { id: "user-1", twoFactorEnabled: false },
}: {
  request: Request;
  path?: string;
  returned?: unknown;
  user?: Record<string, unknown> | null;
}) {
  const createSession = vi.fn(async (userId: string) => ({ id: "session-1", userId }));
  const ctx: PasswordResetEndpointContext = {
    path,
    request,
    context: {
      returned,
      internalAdapter: { findUserById: async () => user, createSession },
    },
  };
  return { ctx, createSession };
}

describe("the password reset session", () => {
  describe("given the reset endpoint accepted my new password", () => {
    let channel: PasswordResetSessionChannel;
    let request: Request;

    beforeEach(() => {
      channel = PasswordResetSessionChannel.create();
      request = new Request("http://localhost/api/auth/reset-password");
      channel.recordPasswordReset({ userId: "user-1", request });
    });

    /** @scenario "A completed reset opens a session for the device that set the password" */
    it("creates a session for my account and sets its cookie", async () => {
      const { ctx, createSession } = contextFor({ request });

      await channel.signInAfterPasswordReset(ctx);

      expect(createSession).toHaveBeenCalledWith("user-1");
      expect(setSessionCookie).toHaveBeenCalled();
    });

    it("opens nothing for an account holding a second factor", async () => {
      const { ctx, createSession } = contextFor({
        request,
        user: { id: "user-1", twoFactorEnabled: true },
      });

      await channel.signInAfterPasswordReset(ctx);

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("given a refused reset", () => {
    it("opens nothing", async () => {
      const channel = PasswordResetSessionChannel.create();
      const request = new Request("http://localhost/api/auth/reset-password");
      const { ctx, createSession } = contextFor({
        request,
        returned: new APIError("BAD_REQUEST", { code: "INVALID_TOKEN" }),
      });

      await channel.signInAfterPasswordReset(ctx);

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("given another endpoint's request", () => {
    it("opens nothing", async () => {
      const channel = PasswordResetSessionChannel.create();
      const request = new Request("http://localhost/api/auth/sign-in/email");
      channel.recordPasswordReset({ userId: "user-1", request });
      const { ctx, createSession } = contextFor({ request, path: "/sign-in/email" });

      await channel.signInAfterPasswordReset(ctx);

      expect(createSession).not.toHaveBeenCalled();
    });
  });
});
