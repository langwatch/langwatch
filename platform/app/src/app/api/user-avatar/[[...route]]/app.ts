/**
 * /api/user-avatar/:projectId/:id — serves a user's uploaded avatar bytes.
 *
 * Unlike /api/files (which gates each read behind the caller's `traces:view` /
 * `scenarios:view` on the owning project), an avatar is platform-level identity
 * that must be visible wherever a person is shown, so this route authorizes ANY
 * authenticated caller on the platform — not only users who share an
 * organization with the uploader. For exactly that reason it MUST only ever
 * serve objects tagged with the `user_avatar` purpose. Any other purpose is a
 * 404 here, so this broad-read route can never be used to exfiltrate the
 * trace/scenario media that /api/files protects.
 *
 * (This is still strictly more private than the status quo: SSO provider photos
 * are fetched from fully public CDN URLs today.)
 *
 * Spec: specs/settings/user-avatar.feature
 */
import { Readable } from "node:stream";
import {
  safeUserAvatarMediaType,
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
} from "@langwatch/user-contract";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { anyAuthenticated, createServiceApp } from "~/server/api/security";
import { rateLimit } from "~/server/rateLimit";
import {
  jsonResponse,
  rateLimitedResponse,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "~/server/stored-objects/media-response";
import type { DualAuthVariables } from "../../middleware/dual-auth";
import { dualAuth } from "../../middleware/dual-auth";

const secured = createServiceApp<{ Variables: DualAuthVariables }>({
  basePath: "/api/user-avatar",
  verifySecret: dualAuth,
});

// Avatars render in dense stacks (member lists, presence bars), so the budget
// is looser than /api/files; still caps enumeration abuse from one credential.
const AVATAR_RATE_LIMIT_WINDOW_SECONDS = 60;
const AVATAR_RATE_LIMIT_MAX = 240;

function streamAvatarResponse({
  row,
  stream,
  method,
}: {
  row: { size_bytes: number; media_type: string };
  stream: Readable;
  method: "GET" | "HEAD";
}): Response {
  const headers: Record<string, string> = {
    "Content-Type": safeUserAvatarMediaType(row.media_type),
    "Content-Length": String(row.size_bytes),
    // Content-addressed id => the bytes at a URL never change, so the browser
    // can cache aggressively. A new upload mints a new id (new URL), and a
    // removal drops the reference entirely, so a cached entry is never stale.
    "Cache-Control": "private, max-age=86400",
    ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
  };

  if (method === "HEAD") {
    stream.destroy?.();
    return new Response(null, { status: 200, headers });
  }
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

async function handleAvatarRead(
  c: Parameters<MiddlewareHandler<{ Variables: DualAuthVariables }>>[0],
  options: { method: "GET" | "HEAD" },
): Promise<Response> {
  const projectId = c.req.param("projectId");
  const id = c.req.param("id");
  if (!projectId || !id) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  // Per-caller rate limit, keyed on the authenticated identity (dualAuth
  // guarantees one is present) so id-enumeration is throttled before any read.
  const callerKey = c.get("apiKeyProjectId") ?? c.get("userId");
  if (!callerKey) {
    throw new HTTPException(500, { message: "rate-limit key unresolved" });
  }
  const rl = await rateLimit({
    key: `user-avatar:caller:${callerKey}`,
    windowSeconds: AVATAR_RATE_LIMIT_WINDOW_SECONDS,
    max: AVATAR_RATE_LIMIT_MAX,
  });
  if (!rl.allowed) {
    return rateLimitedResponse(rl.resetAt);
  }

  let result;
  try {
    result = await c.app.userAvatarObjects.getById({
      projectId,
      id,
    });
  } catch {
    return jsonResponse({ error: "avatar temporarily unavailable" }, 502);
  }

  // A missing row, or ANY object that is not a user avatar, is a 404 — the
  // purpose/owner check is the security boundary that keeps this broadly
  // readable route from serving trace/scenario media (see file header).
  if (
    !result ||
    result.metadata.purpose !== USER_AVATAR_PURPOSE ||
    result.metadata.ownerKind !== USER_AVATAR_OWNER_KIND
  ) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  if (result.status === "missing") {
    return jsonResponse({ status: "missing" }, 404);
  }

  return streamAvatarResponse({
    row: {
      size_bytes: result.metadata.byteLength,
      media_type: result.metadata.mediaType,
    },
    stream: result.stream,
    method: options.method,
  });
}

secured
  .access(anyAuthenticated())
  .get("/:projectId/:id", (c) => handleAvatarRead(c, { method: "GET" }));
secured
  .access(anyAuthenticated())
  .head("/:projectId/:id", (c) => handleAvatarRead(c, { method: "HEAD" }));

export const app = secured.hono;
export type UserAvatarAppType = typeof app;
