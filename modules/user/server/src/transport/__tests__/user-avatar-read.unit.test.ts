/**
 * @vitest-environment node
 * The gate that makes `/api/user-avatar` safe to read broadly, through the
 * real declaration.
 * Spec: specs/settings/user-avatar-upload.feature
 */
import { createRestRuntime, bindRestMiddleware } from "@langwatch/api/rest";
import type { UserApi, UserAvatarObjectRead } from "@langwatch/user-contract";
import type { ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { userAvatarCaller, userAvatarRest } from "../user-avatar.rest.ts";

describe("given the avatar route", () => {
  describe("when the object is a user avatar", () => {
    /** @scenario The avatar route serves an object whose purpose and owner kind are the avatar ones */
    it("serves the bytes with the stored media type and a private cache", async () => {
      const api = mountAvatars(available());

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Content-Length")).toBe("3");
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    });
  });

  describe("when the object carries a purpose that is not the avatar one", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses with the avatar not-found code, serving no bytes", async () => {
      const api = mountAvatars(
        available({ purpose: "trace_content", ownerKind: "span", mediaType: "audio/mpeg" }),
      );

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the object is tagged as an avatar but was produced by a span", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses on the OWNER KIND, so a forged purpose alone opens nothing", async () => {
      const api = mountAvatars(available({ ownerKind: "span" }));

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when there is no object at all", () => {
    /** @scenario "A URL with no avatar behind it is refused the same way as a foreign object" */
    it("answers the SAME code as a refused object, so the route is no existence oracle", async () => {
      const api = mountAvatars(null);

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the row is an avatar but its bytes are gone", () => {
    /** @scenario "A URL with no avatar behind it is refused the same way as a foreign object" */
    it("answers that same code rather than confirming the id exists", async () => {
      const api = mountAvatars({
        status: "missing",
        metadata: {
          byteLength: 3,
          mediaType: "image/png",
          purpose: "user_avatar",
          ownerKind: "user",
        },
      });

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the caller has already read too many avatars", () => {
    it("answers the throttle rather than looking the object up", async () => {
      let looked = false;
      const api = mountAvatars(available(), {
        allowance: { allowed: false, resetAt: 1_000 },
        onRead: () => {
          looked = true;
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

/** One avatar read, defaulted to a real avatar so a case changes only its point. */
function available(
  overrides: { purpose?: string; ownerKind?: string; mediaType?: string } = {},
): UserAvatarObjectRead {
  return {
    status: "available",
    metadata: {
      byteLength: 3,
      mediaType: overrides.mediaType ?? "image/png",
      purpose: overrides.purpose ?? "user_avatar",
      ownerKind: overrides.ownerKind ?? "user",
    },
    stream: streamOf(Uint8Array.from([1, 2, 3])),
  };
}

/**
 * The family over a session-authenticated caller. The dual-credential verifier
 * is the process's, and the handler keys its count on what that verifier left
 * behind — so a binding setting nothing would fail before any refusal.
 */
function mountAvatars(
  read: UserAvatarObjectRead,
  options: {
    allowance?: { allowed: boolean; resetAt: number };
    onRead?: () => void;
  } = {},
) {
  const app = {
    countAvatarRead: async () => options.allowance ?? { allowed: true, resetAt: 0 },
    readAvatarObject: async () => {
      options.onRead?.();

      return read;
    },
  } as unknown as UserApi;

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("An avatar read asks no permission of its credential.");
      },
      identify: () => ({ actor: { type: "user", id: "user-1" } as const, scope: null }),
    },
  });

  const hono = runtime.mount(userAvatarRest.router(), {
    app: () => app,
    credential: "session",
    facts: [
      bindRestMiddleware(userAvatarCaller, () => ({ apiKeyProjectId: null, userId: "user-1" })),
    ],
    onError: renderHandled,
  });

  return {
    fetch: (path: string) => hono.fetch(new Request(`http://api.test${path}`)),
  };
}

/** A handled refusal reaches the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number; code?: string };
  const status = handled.status ?? handled.httpStatus;

  if (typeof status === "number") return c.json({ error: handled.code ?? "error" }, status as never);

  return c.json({ error: String(error) }, 500);
};
