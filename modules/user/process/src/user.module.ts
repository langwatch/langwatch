import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import { defineProcessModule } from "@langwatch/process";
import type { MePersonalCredential } from "@langwatch/user-contract";

import { UserModule } from "./app/user.app.ts";
import { userLifecycleEventing } from "./eventing/user-lifecycle.pipeline.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import { createGdprUserDataEraseRunner } from "./tasks/user-data-erase.task.ts";
import { mePersonalCredential, meRest } from "./transport/me.rest.ts";
import { userAvatarRest } from "./transport/user-avatar.rest.ts";
import { signUpOriginFact, userTrpcTransport } from "./transport/user.trpc.ts";

export const userProcessModule = defineProcessModule("user")
  .withRepositories(userRepositories)
  .withApi(UserModule)
  .withTransports(meRest, userAvatarRest, userTrpcTransport)
  .withEventing(userLifecycleEventing)
  .withTasks(({ repositories }) => [
    createGdprUserDataEraseRunner({ repository: repositories.dataErase }),
  ])
  // The credential whole rather than in pieces: a personal-usage answer is
  // refused for a key that is not the asking member's own, and the door's
  // answer is the only place that can be read from.
  .withTransportFacts(() => [
    bindRestMiddleware(mePersonalCredential, (context): MePersonalCredential => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type === "legacyProjectKey") return { kind: "legacyProjectKey" };
      if (credential.type === "cliAccessToken") {
        return {
          kind: "cliAccessToken",
          userId: credential.userId,
          organizationId: credential.organizationId,
        };
      }

      return {
        kind: "apiKey",
        userId: credential.userId,
        organizationId: credential.organizationId,
      };
    }),
    // A Node header may arrive repeated; the first value is the one the browser sent.
    bindTrpcFact(signUpOriginFact, (context: TrpcRuntimeContext) => ({
      origin: [context.req?.headers.origin].flat()[0] ?? null,
      referer: [context.req?.headers.referer].flat()[0] ?? null,
    })),
  ]);
