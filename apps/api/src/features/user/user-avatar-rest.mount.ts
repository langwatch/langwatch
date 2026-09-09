/**
 * Binds `/api/user-avatar` to this process's byte door: a browser fires
 * `<img src="…">` with a cookie and no headers, so the family answers behind
 * the dual-credential verifier the runtime installs under every session door.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import type { UserApi } from "@langwatch/user-contract";
import { userAvatarCaller, userAvatarRest } from "@langwatch/user-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/user-avatar/:projectId/:id` behind the byte door. */
export function mountUserAvatarRest(
  runtime: ApiRestRuntime,
  users: () => UserApi,
): MountableRestApp {
  return runtime.mount(userAvatarRest.router(), users, {
    // Who the verifier let in, read off the door's own answer: the read is
    // counted against the key or the person, and one of the two is always
    // there because the door refused the request otherwise.
    facts: [
      bindRestMiddleware(userAvatarCaller, (context) => {
        const caller = runtime.browserCallerOf(context.req.raw);

        return {
          apiKeyProjectId: caller.apiKeyProjectId ?? null,
          userId: caller.userId ?? null,
        };
      }),
    ],
  });
}
