/**
 * `/api/user-avatar/:projectId/:id` — a person's photo, readable by any
 * authenticated caller. An object is served only when BOTH its purpose and its
 * owner kind are the avatar ones, and every other outcome answers the same
 * refusal, so the route is no existence oracle over object ids.
 * Spec: specs/settings/user-avatar-upload.feature.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  jsonResponse,
  MANAGEMENT_API_VERSION,
  rateLimitedResponse,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  type RestRawResult,
} from "@langwatch/api/rest";
import {
  safeUserAvatarMediaType,
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserApi,
  userAvatarCallerSchema,
  UserAvatarNotFoundError,
  type UserAvatarObjectRead,
} from "@langwatch/user-contract";
import { z } from "zod";

// Avatars render in dense stacks (member lists, presence bars), so the budget
// is looser than the shared byte door's; it still caps enumeration abuse from
// one credential.
const AVATAR_RATE_LIMIT_WINDOW_SECONDS = 60;
const AVATAR_RATE_LIMIT_MAX = 240;

/**
 * Who the deployment's dual-credential verifier let in. A browser fires
 * `<img src="…">` with a cookie and no headers, so a key-only door would
 * refuse every member list.
 */
export const userAvatarCaller = defineRestMiddleware("userAvatarCaller", userAvatarCallerSchema);

const OWNER_IS_IN_THE_PATH =
  "any authenticated caller may read any avatar, so the door authenticates and resolves no scope; " +
  "the object's purpose and owner kind are what gate the bytes";

export const userAvatarRest = defineRestRouter(UserApi)
  .withNamespace("user-avatar")
  .withVersion(MANAGEMENT_API_VERSION)
  // The browser's own door: a project API key opens the same one.
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/user-avatar/:projectId/:id", "readUserAvatarBytes")
  .withParams(z.object({ projectId: z.string(), id: z.string() }))
  .withAccess(deferredScope({ reason: OWNER_IS_IN_THE_PATH }))
  .withMiddleware(userAvatarCaller)
  .withRawResponse({ produces: "image/*" })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input }, caller) => {
    const allowance = await app.countAvatarRead({
      caller,
      windowSeconds: AVATAR_RATE_LIMIT_WINDOW_SECONDS,
      max: AVATAR_RATE_LIMIT_MAX,
    });

    if (!allowance.allowed) return rateLimitedResponse(allowance.resetAt);

    let result: UserAvatarObjectRead;

    try {
      result = await app.readAvatarObject({ projectId: input.projectId, id: input.id });
    } catch {
      return jsonResponse({ error: "avatar temporarily unavailable" }, 502);
    }

    // A missing row, and ANY object that is not a user avatar, earn the SAME
    // refusal: `purpose` says what the object is for and `owner_kind` says what
    // produced it, and an object carrying one without the other is no avatar.
    if (!isUserAvatar(result)) throw new UserAvatarNotFoundError(input.id);

    // The row is an avatar but the bytes are gone. The same refusal again, so
    // this route never confirms an id exists to a caller it would not serve.
    if (result.status === "missing") throw new UserAvatarNotFoundError(input.id);

    return avatarBytes(result);
  })
  .build();

function isUserAvatar(result: UserAvatarObjectRead): result is NonNullable<UserAvatarObjectRead> {
  return (
    result !== null &&
    result.metadata.purpose === USER_AVATAR_PURPOSE &&
    result.metadata.ownerKind === USER_AVATAR_OWNER_KIND
  );
}

/**
 * Content-addressed id, so the bytes at a URL never change and the browser may
 * cache hard: a new upload mints a new id, and a removal drops the reference.
 */
function avatarBytes(
  result: Extract<NonNullable<UserAvatarObjectRead>, { status: "available" }>,
): RestRawResult {
  return {
    status: 200,
    headers: {
      "Content-Type": safeUserAvatarMediaType(result.metadata.mediaType),
      "Content-Length": String(result.metadata.byteLength),
      "Cache-Control": "private, max-age=86400",
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
    body: result.stream,
  };
}
