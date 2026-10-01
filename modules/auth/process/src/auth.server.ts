import { bindApiDoor } from "@langwatch/api/hosting";
import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import { defineServerModule } from "@langwatch/kernel";

import { AuthApp } from "./app/auth.app.ts";
import { authLifecycleEventing } from "./eventing/auth-lifecycle.pipeline.ts";
import { authEventing } from "./eventing/auth.pipeline.ts";
import { authRepositories } from "./repositories/auth-repositories.registry.ts";
import { ApiDoorService } from "./services/api-door.service.ts";
import { ClearStalePendingSsoSetupTask } from "./tasks/clear-stale-pending-sso-setup.task.ts";
import { authCliDeviceFlowRest } from "./transport/auth-cli-device-flow.rest.ts";
import { authRest } from "./transport/auth.rest.ts";
import { authRequestHeadersFact, authTrpcTransport } from "./transport/auth.trpc.ts";
import { signInSecurityTrpcTransport } from "./transport/sign-in-security.trpc.ts";

/**
 * auth.* and /api/auth routes over one application. App builds the Better
 * Auth instance. The CLI device grant mounts before the /api/auth catch-all.
 * auth binds the one API door every request passes (record §8).
 */
export const authServer = defineServerModule("auth")
  .withRepositories(authRepositories)
  .withApp(AuthApp)
  .withTransports(authTrpcTransport, signInSecurityTrpcTransport, authCliDeviceFlowRest, authRest)
  .withEventing(authEventing)
  .withEventing(authLifecycleEventing)
  .withTasks(({ members }) => [
    ClearStalePendingSsoSetupTask.create({ database: () => members.prisma }),
  ])
  .withTransportFacts(({ app, dependencies }) => {
    if (!(app instanceof AuthApp)) {
      throw new TypeError("The auth API door requires its constructed application");
    }

    return [
      bindTrpcFact(
        authRequestHeadersFact,
        (context: TrpcRuntimeContext) => context.req?.headers ?? null,
      ),
      bindApiDoor(
        ApiDoorService.create({
          sessions: app,
          apiKeys: dependencies.apiKeys,
          cliProjects: app,
          authz: dependencies.authz,
          organizations: dependencies.organizations,
          entitlements: dependencies.entitlements,
          auditLog: dependencies.auditLog,
        }).door(),
      ),
    ];
  });
