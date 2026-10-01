/**
 * @vitest-environment node
 * The avatar door through its real declaration: bytes, the module's refusal,
 * and the throttle that runs before any lookup.
 * Spec: specs/settings/user-avatar-upload.feature
 */
import { ProjectMissingCredentialsError } from "@langwatch/api";
import { createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserAvatarNotFoundError } from "@langwatch/user-contract";
import type { ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import type { ServableUserAvatar } from "../../rules/user-avatar-read.rules.ts";
import { type UserAvatarFileApi, userAvatarRest } from "../user-avatar.rest.ts";

describe("given the avatar route", () => {
  describe("when the object is a user avatar", () => {
    /** @scenario The avatar route serves an object whose purpose and owner kind are the avatar ones */
    it("serves the bytes with the stored media type and a private cache", async () => {
      const api = mountAvatars({ read: async () => available() });

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Content-Length")).toBe("3");
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    });
  });

  describe("when the module refuses the object", () => {
    it("answers the avatar not-found code, serving no bytes", async () => {
      const api = mountAvatars({
        read: async () => {
          throw new UserAvatarNotFoundError("object-1");
        },
      });

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the request carries a session cookie and no API key", () => {
    it("answers 401, since REST authenticates with API keys only", async () => {
      let looked = false;
      const api = mountAvatars({
        read: async () => {
          looked = true;
          return available();
        },
      });

      const response = await api.fetch("/api/user-avatar/project-9/object-1", {
        cookie: "better-auth.session_token=a-live-session",
      });

      expect(response.status).toBe(401);
      expect(looked).toBe(false);
    });
  });

  describe("when the request carries no credential at all", () => {
    /** @scenario An unauthenticated request cannot load an avatar image */
    it("answers 401 and looks nothing up", async () => {
      let looked = false;
      const api = mountAvatars({
        read: async () => {
          looked = true;
          return available();
        },
      });

      const response = await api.fetch("/api/user-avatar/project-9/object-1", {});

      expect(response.status).toBe(401);
      expect(looked).toBe(false);
    });
  });

  describe("when the key belongs to another project than the one the address names", () => {
    it("answers 403, since the runtime pins a key to its own project", async () => {
      const api = mountAvatars({ read: async () => available() });

      const response = await api.fetch("/api/user-avatar/project-9/object-1", {
        authorization: "Bearer key-for:project-other",
      });

      expect(response.status).toBe(403);
    });
  });

  describe("when the caller has already read too many avatars", () => {
    it("answers the throttle rather than looking the object up", async () => {
      let looked = false;
      const api = mountAvatars({
        allowed: false,
        read: async () => {
          looked = true;
          return available();
        },
      });

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(429);
      expect(looked).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The bytes the object store hands over, as the web stream the answer carries. */
function streamOf(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** A servable avatar, as the module hands it to the door. */
function available(): ServableUserAvatar {
  return {
    status: "available",
    metadata: {
      byteLength: 3,
      mediaType: "image/png",
      purpose: "user_avatar",
      ownerKind: "user",
    },
    stream: streamOf(Uint8Array.from([1, 2, 3])),
  };
}

/** The family behind a project-key door, counted by a limiter the case decides. */
function mountAvatars(options: { read: UserAvatarFileApi["getAvatarBytes"]; allowed?: boolean }) {
  const app = createApiFixture<UserAvatarFileApi>({ getAvatarBytes: options.read });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("An avatar read asks no permission of its credential.");
      },
      identify: ({ request }) => {
        const projectId = request.headers.get("authorization")?.replace("Bearer key-for:", "");
        if (!projectId) throw new ProjectMissingCredentialsError();

        return { actor: null, scope: { tier: "project", id: projectId } };
      },
    },
    rateLimiter: { check: async () => ({ allowed: options.allowed ?? true }) },
  });

  const hono = runtime.mount(userAvatarRest.router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
  });

  return {
    fetch: (
      path: string,
      headers: Record<string, string> = { authorization: "Bearer key-for:project-9" },
    ) => hono.fetch(new Request(`http://api.test${path}`, { headers })),
  };
}

/** A handled refusal reaches the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number; code?: string };
  const status = handled.status ?? handled.httpStatus;

  if (typeof status === "number")
    return c.json({ error: handled.code ?? "error" }, status as never);

  return c.json({ error: String(error) }, 500);
};
