/**
 * The gate that makes `/api/user-avatar` safe to read broadly.
 *
 * The route authorizes ANY authenticated caller on the platform, so the only
 * thing standing between it and one tenant pulling another's trace media is its
 * refusal of every object whose purpose AND owner kind are not the avatar ones.
 * Both halves are driven here, and the refusal is asserted on its CODE rather
 * than on the sentence, because the sentence is copy.
 *
 * Spec: specs/settings/user-avatar-upload.feature
 */
import { createAppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  createUserAvatarRestApp,
  type UserAvatarObjectReader,
  type UserAvatarStoredObjectRead,
} from "../user-avatar.api";

describe("given the avatar route", () => {
  describe("when the object is a user avatar", () => {
    /** @scenario "The avatar route serves an object whose purpose and owner kind are the avatar ones" */
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
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** One avatar read, defaulted to a real avatar so a case changes only its point. */
function available(
  overrides: { purpose?: string; ownerKind?: string; mediaType?: string } = {},
): UserAvatarStoredObjectRead {
  return {
    status: "available",
    metadata: {
      byteLength: 3,
      mediaType: overrides.mediaType ?? "image/png",
      purpose: overrides.purpose ?? "user_avatar",
      ownerKind: overrides.ownerKind ?? "user",
    },
    stream: Readable.from([Buffer.from([1, 2, 3])]),
  };
}

/**
 * The family over a session-authenticated caller.
 *
 * The dual-auth verifier is the process's, and the handler keys its rate limit
 * on what that verifier leaves behind — so a pass-through setting nothing would
 * fail before any refusal was reached.
 */
function mountAvatars(read: UserAvatarStoredObjectRead) {
  const objects: UserAvatarObjectReader = { getById: async () => read };
  const app = createUserAvatarRestApp({
    security: passThroughSecurity(),
    dualAuth: async (c, next) => {
      c.set("userId", "user-1");
      await next();
    },
    userAvatarObjects: () => objects,
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
  });

  const hono = new Hono();
  hono.route("/", app.hono as never);
  return {
    fetch: (path: string) => hono.fetch(new Request(`http://api.test${path}`)),
  };
}

/** A handled refusal reaches the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};

function passThroughSecurity() {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}
