import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import { defineProcessModule } from "@langwatch/process";

import { UserModule } from "./app/user.app.ts";
import { userLifecycleEventing } from "./eventing/user-lifecycle.pipeline.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import { createGdprUserDataEraseRunner } from "./tasks/user-data-erase.task.ts";
import { meRest } from "./transport/me.rest.ts";
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
  .withTransportFacts(() => [
    // A Node header may arrive repeated; the first value is the one the browser sent.
    bindTrpcFact(signUpOriginFact, (context: TrpcRuntimeContext) => ({
      origin: [context.req?.headers.origin].flat()[0] ?? null,
      referer: [context.req?.headers.referer].flat()[0] ?? null,
    })),
  ]);
