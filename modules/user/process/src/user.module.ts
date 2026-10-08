import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi, UserServerConfig } from "@langwatch/user-contract";

import { UserModule } from "./app/user.app.ts";
import { userChannels } from "./channels/user-channels.registry.ts";
import { userLifecycleEventing } from "./eventing/user-lifecycle.pipeline.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import { createGdprUserDataEraseRunner } from "./tasks/user-data-erase.task.ts";
import { meRest } from "./transport/me.rest.ts";
import { userAvatarRest } from "./transport/user-avatar.rest.ts";
import { signUpOriginFact, userTrpcTransport } from "./transport/user.trpc.ts";

export const userProcessModule: PublishedProcessModule<"user", UserApi, UserServerConfig> =
  defineProcessModule("user")
    .withRepositories(userRepositories)
    .withChannels(userChannels)
    .withApi(UserModule)
    .withTransports(meRest, userAvatarRest, userTrpcTransport)
    .withEventing(userLifecycleEventing)
    .withTasks(({ repositories }) => [
      createGdprUserDataEraseRunner({ repository: repositories.dataErase }),
    ])
    .withMigrations(({ app }) => [
      defineMigrationStep({
        id: "user:record-created-facts",
        kind: "data",
        mode: "background",
        description: "Records every existing account as user's created fact, for peers to read.",
        // An old image still minting accounts records no created fact: wait until none serves.
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterUserId;
          return app.recordExistingCreatedFacts({
            dryRun,
            signal,
            afterUserId: typeof resumed === "string" ? resumed : null,
            onPageDone: ({ afterUserId, report }) =>
              checkpoint.save({ report: { afterUserId, ...report } }),
          });
        },
      }),
    ])
    .withTransportFacts(() => [
      // A Node header may arrive repeated; the first value is the one the browser sent.
      bindTrpcFact(signUpOriginFact, (context: TrpcRuntimeContext) => ({
        origin: [context.req?.headers.origin].flat()[0] ?? null,
        referer: [context.req?.headers.referer].flat()[0] ?? null,
      })),
    ]);
