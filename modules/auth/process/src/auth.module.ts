import { bindApiDoor } from "@langwatch/api/hosting";
import { bindTrpcMiddlewareContext, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import type { AuthApi, AuthServerConfig } from "@langwatch/auth-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { AuthModule } from "./app/auth.app.ts";
import { authChannels } from "./channels/auth-channels.registry.ts";
import { authLifecycleEventing } from "./eventing/auth-lifecycle.pipeline.ts";
import { authEventing } from "./eventing/auth.pipeline.ts";
import { authRepositories } from "./repositories/auth-repositories.registry.ts";
import { ApiDoorService } from "./services/api-door.service.ts";
import { ClearStalePendingSsoSetupTask } from "./tasks/clear-stale-pending-sso-setup.task.ts";
import { authCliDeviceFlowRest } from "./transport/auth-cli-device-flow.rest.ts";
import { authRest } from "./transport/auth.rest.ts";
import { authRequestHeadersContext, authTrpcTransport } from "./transport/auth.trpc.ts";
import { signInSecurityTrpcTransport } from "./transport/sign-in-security.trpc.ts";

/**
 * auth.* and /api/auth routes over one application. App builds the Better
 * Auth instance. The CLI device grant mounts before the /api/auth catch-all.
 * auth binds the one API door every request passes (record §8).
 */
export const authProcessModule: PublishedProcessModule<"auth", AuthApi, AuthServerConfig> =
  defineProcessModule("auth")
    .withRepositories(authRepositories)
    .withChannels(authChannels)
    .withApi(AuthModule)
    .withTransports(authTrpcTransport, signInSecurityTrpcTransport, authCliDeviceFlowRest, authRest)
    .withEventing(authEventing)
    .withEventing(authLifecycleEventing)
    .withTasks(({ repositories, dependencies }) => [
      ClearStalePendingSsoSetupTask.create({
        candidates: repositories.pendingSsoSetup,
        organizations: dependencies.organizations,
      }),
    ])
    .provideMiddlewareBindings(({ app, dependencies }) => [
      bindTrpcMiddlewareContext(
        authRequestHeadersContext,
        (context: TrpcRuntimeContext) => context.req?.headers ?? null,
      ),
      bindApiDoor(
        ApiDoorService.create({
          sessions: app,
          twoStep: app,
          identity: dependencies.identity,
          apiKeys: dependencies.apiKeys,
          cliProjects: app,
          authz: dependencies.authz,
          organizations: dependencies.organizations,
          entitlements: dependencies.entitlements,
          auditLog: dependencies.auditLog,
        }).door(),
      ),
    ]);
