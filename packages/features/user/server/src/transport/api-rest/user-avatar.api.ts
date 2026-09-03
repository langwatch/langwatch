/**
 * /api/user-avatar/:projectId/:id — serves a user's uploaded avatar bytes.
 *
 * Unlike /api/files (which gates each read behind the caller's `traces:view` /
 * `scenarios:view` on the owning project), an avatar is platform-level identity
 * that must be visible wherever a person is shown, so this route authorizes ANY
 * authenticated caller on the platform — not only users who share an
 * organization with the uploader. For exactly that reason it MUST only ever
 * serve objects whose purpose AND owner kind are the avatar ones. Anything else
 * is refused with {@link UserAvatarNotFoundError}, so this broad-read route can
 * never be used to exfiltrate the trace/scenario media that /api/files
 * protects. The refusal carries ONE code for every reason there is no avatar at
 * a URL — see that error for why the three are not told apart.
 *
 * That check is only as good as what the process's read hands it: a reader that
 * answered a row without `ownerKind` would fail the comparison on every object,
 * including real avatars. `StoredObjectFileRow` carries both columns for this
 * reason.
 *
 * (This is still strictly more private than the status quo: SSO provider photos
 * are fetched from fully public CDN URLs today.)
 *
 * Spec: specs/settings/user-avatar-upload.feature (serving), and
 * specs/settings/user-avatar.feature (the upload's refusals).
 */
import { Readable } from "node:stream";

import {
  safeUserAvatarMediaType,
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserAvatarNotFoundError,
} from "@langwatch/user-contract";
import type { Env, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { anyAuthenticated } from "@langwatch/api";
import {
  type AppRestSecurity,
  jsonResponse,
  rateLimitedResponse,
  type SecuredApp,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "@langwatch/api/rest";

/**
 * A fixed-window counter, keyed on the caller.
 *
 * Structurally the same port `/api/files` takes, and the process binds one
 * implementation to both. It is declared here rather than imported because
 * `user` is a core feature and the stored-object REST family lives in another
 * feature's server package, which this one may not depend on.
 */
export type UserAvatarRateLimiter = (args: {
  key: string;
  windowSeconds: number;
  max: number;
}) => Promise<{ allowed: boolean; resetAt: number }>;

/**
 * What the family's dual-auth verifier leaves on the request context.
 *
 * Named here rather than imported because the verifier itself is the
 * application's — the family only needs to know which of the two credential
 * kinds claimed the request, to key the rate limit on it.
 */
export type UserAvatarDualAuthVariables = {
  apiKeyProjectId?: string;
  userId?: string;
};

/** One avatar read, as the process's stored-object bridge answers it. */
export type UserAvatarStoredObjectRead =
  | {
      status: "available";
      metadata: {
        byteLength: number;
        mediaType: string;
        purpose: string;
        ownerKind: string;
      };
      stream: Readable;
    }
  | {
      status: "missing";
      metadata: {
        byteLength: number;
        mediaType: string;
        purpose: string;
        ownerKind: string;
      };
    }
  | null;

/** The avatar bytes, by project and content-addressed id. */
export interface UserAvatarObjectReader {
  getById(input: { projectId: string; id: string }): Promise<UserAvatarStoredObjectRead>;
}

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

export function createUserAvatarRestApp<
  E extends Env = { Variables: UserAvatarDualAuthVariables },
>(options: {
  security: AppRestSecurity;
  /**
   * Accepts either a project API key or a browser session, and refuses a
   * request carrying both: a browser fires `<img src="/api/user-avatar/...">`
   * with the cookie and no custom headers, so a key-only chain would 401 every
   * member list.
   */
  dualAuth: MiddlewareHandler;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  userAvatarObjects: () => UserAvatarObjectReader;
  rateLimit: UserAvatarRateLimiter;
}): SecuredApp<E> {
  const { security, dualAuth, userAvatarObjects, rateLimit } = options;

  const secured = security.createServiceApp<E>({
    basePath: "/api/user-avatar",
    verifySecret: dualAuth,
  });

  async function handleAvatarRead(
    c: Parameters<MiddlewareHandler<{ Variables: UserAvatarDualAuthVariables }>>[0],
    read: { method: "GET" | "HEAD" },
  ): Promise<Response> {
    const projectId = c.req.param("projectId");
    const id = c.req.param("id");
    if (!projectId || !id) {
      throw new UserAvatarNotFoundError(id ?? "");
    }

    // Per-caller rate limit, keyed on the authenticated identity (dualAuth
    // guarantees one is present) so id-enumeration is throttled before any
    // read.
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

    let result: UserAvatarStoredObjectRead;
    try {
      result = await userAvatarObjects().getById({ projectId, id });
    } catch {
      return jsonResponse({ error: "avatar temporarily unavailable" }, 502);
    }

    // A missing row, or ANY object that is not a user avatar, is refused — the
    // purpose/owner check is the security boundary that keeps this broadly
    // readable route from serving trace/scenario media (see file header). BOTH
    // halves are checked: `purpose` says what the object is for and
    // `owner_kind` says what produced it, and an object carrying one without
    // the other is not an avatar.
    if (
      !result ||
      result.metadata.purpose !== USER_AVATAR_PURPOSE ||
      result.metadata.ownerKind !== USER_AVATAR_OWNER_KIND
    ) {
      throw new UserAvatarNotFoundError(id);
    }

    // The row is an avatar but the bytes are gone. The SAME refusal, so this
    // route never confirms that an id exists to a caller it would not serve.
    if (result.status === "missing") {
      throw new UserAvatarNotFoundError(id);
    }

    return streamAvatarResponse({
      row: {
        size_bytes: result.metadata.byteLength,
        media_type: result.metadata.mediaType,
      },
      stream: result.stream,
      method: read.method,
    });
  }

  secured
    .access(anyAuthenticated())
    .get("/:projectId/:id", (c) => handleAvatarRead(c as never, { method: "GET" }));
  secured
    .access(anyAuthenticated())
    .head("/:projectId/:id", (c) => handleAvatarRead(c as never, { method: "HEAD" }));

  return secured;
}
