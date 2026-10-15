import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi, UserServerConfig } from "@langwatch/user-contract";

import { UserModule } from "./app/user.app.ts";
import { userChannels } from "./channels/user-channels.registry.ts";
import { userLifecycleEventing } from "./eventing/user-lifecycle.pipeline.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import {
  UserAddressLowerCaseService,
  userAddressLowerCaseReportSchema,
} from "./services/user-address-lower-case.service.ts";
import { createGdprUserDataEraseRunner } from "./tasks/user-data-erase.task.ts";
import { meRest } from "./transport/me.rest.ts";
import { userAvatarRest } from "./transport/user-avatar.rest.ts";
import { userTrpcTransport } from "./transport/user.trpc.ts";

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
    .withMigrations(({ app, repositories }) => [
      defineMigrationStep({
        id: "user:record-created-facts",
        kind: "data",
        mode: "background",
        description:
          "Records every existing account's created fact and re-states its standing, for peers to read.",
        // An old image still minting or changing accounts records no fact: wait until none serves.
        needsOldWritersGone: true,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterUserId;
          const count = (key: "users" | "deactivated" | "reactivated"): number => {
            const counted = checkpoint.resumeFrom?.[key];
            return typeof counted === "number" ? counted : 0;
          };
          return app.recordExistingCreatedFacts({
            dryRun,
            signal,
            afterUserId: typeof resumed === "string" ? resumed : null,
            countedBefore: {
              users: count("users"),
              deactivated: count("deactivated"),
              reactivated: count("reactivated"),
            },
            onPageDone: ({ afterUserId, report }) =>
              checkpoint.save({ report: { afterUserId, ...report } }),
          });
        },
      }),
      defineMigrationStep({
        id: "user:lower-case-stored-addresses",
        kind: "data",
        mode: "background",
        description:
          "Lower-cases every stored account address; when another account already holds the lower-cased address, the account is left as it is and listed in the step report for an admin to fix by hand.",
        needsOldWritersGone: false,
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = userAddressLowerCaseReportSchema.safeParse(checkpoint.resumeFrom);
          const resumeFrom = resumed.success ? resumed.data : null;
          return UserAddressLowerCaseService.create({ users: repositories.users }).lowerCaseStored({
            dryRun,
            signal,
            resumeFrom,
            onPageDone: ({ report }) => checkpoint.save({ report }),
          });
        },
      }),
    ]);
