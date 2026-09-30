/**
 * `/api/user-avatar/:projectId/:id` — readable by a key of that project
 * only when BOTH purpose and owner kind are the avatar ones; every other
 * outcome answers the same refusal. Spec: specs/settings/user-avatar-upload.feature.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  type RestBytesProducer,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import { safeUserAvatarMediaType, userAvatarRestParamsSchema } from "@langwatch/user-contract";

import type { ServableUserAvatar } from "../rules/user-avatar-read.rules.ts";

/** What the avatar door reaches: one read that refuses everything but a servable avatar. */
export interface UserAvatarFileApi {
  getAvatarBytes(input: { projectId: string; id: string }): Promise<ServableUserAvatar>;
}

export const UserAvatarFileApi = moduleApi<UserAvatarFileApi>()("user");

// Avatars render in dense stacks (member lists, presence bars), so the budget
// is looser than the shared byte door's; it still caps enumeration abuse from
// one credential.
const AVATAR_READS_PER_MINUTE = 240;

const AVATAR_MEDIA_TYPES = "image/*";

const OWNER_IS_IN_THE_PATH =
  "a key reads the avatars its own project stores, which the runtime pins; " +
  "the object's purpose and owner kind are what gate the bytes";

export const userAvatarRest = defineRestRouter(UserAvatarFileApi)
  .withNamespace("user-avatar")
  .withVersion(MANAGEMENT_API_VERSION)
  // REST is the API key's (ARCHITECTURE.md §8): the UI reads avatars through tRPC.
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/user-avatar/:projectId/:userAvatarId", "readUserAvatarBytes")
  .withParams(userAvatarRestParamsSchema)
  .withAccess(deferredScope({ reason: OWNER_IS_IN_THE_PATH }))
  .withRateLimit({ requests: AVATAR_READS_PER_MINUTE, seconds: 60 })
  .withResponse("bytes", { produces: AVATAR_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, response }) =>
    avatarBytes({
      response,
      avatar: await app.getAvatarBytes({ projectId: input.projectId, id: input.userAvatarId }),
    }),
  )
  .build();

/**
 * Content-addressed id, so the bytes at a URL never change and the browser may
 * cache hard: a new upload mints a new id, and a removal drops the reference.
 */
function avatarBytes(input: {
  response: RestBytesProducer<typeof AVATAR_MEDIA_TYPES>;
  avatar: ServableUserAvatar;
}) {
  return input.response.stream(input.avatar.stream, {
    mediaType: safeUserAvatarMediaType(input.avatar.metadata.mediaType),
    byteLength: input.avatar.metadata.byteLength,
    headers: STORED_OBJECT_RESPONSE_BASE_HEADERS,
    cacheSeconds: 86_400,
  });
}
