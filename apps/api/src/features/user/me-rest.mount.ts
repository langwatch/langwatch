/**
 * Binds `/api/me` to this process's project door. The credential travels whole
 * rather than in pieces: whether a key may answer FOR a person is the
 * application's question, and the credential's class is half of it.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import type { UserApi } from "@langwatch/user-contract";
import { meRest, mePersonalCredential } from "@langwatch/user-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/me` behind this process's project credential. */
export function mountMeRest(runtime: ApiRestRuntime, users: () => UserApi): MountableRestApp {
  return runtime.mount(meRest.router(), users, {
    facts: [
      bindRestMiddleware(mePersonalCredential, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);
        if (credential.type !== "apiKey") return { kind: "legacyProjectKey" };

        return {
          kind: "apiKey",
          userId: credential.userId,
          organizationId: credential.organizationId,
        };
      }),
    ],
  });
}
