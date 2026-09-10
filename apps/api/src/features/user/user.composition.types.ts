/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AuthApi } from "@langwatch/auth-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type {
  createIdentityTrpcRouter,
  createUserTrpcRouter,
} from "./user-trpc.mount.ts";

/** The two namespaces, the slices, and the session service composed beside them. */
export type ComposedUserFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    user: ReturnType<typeof createUserTrpcRouter<ApiTrpcContext>>;
    identity: ReturnType<typeof createIdentityTrpcRouter<ApiTrpcContext>>;
  };
  /** The `ctx.app.users` slice. */
  app: UserApi;
  /**
   * The browser-session service, composed on the SAME runtime: Auth resolves a
   * signed-in person through the user application and the user application
   * revokes sessions through Auth, so one graph answers both directions.
   */
  auth: AuthApi;
  /** The identity app, booted on the SAME runtime, for every other feature's address lock. */
  identity: IdentityApi;
  /** The `ctx.app.config` slice: the operator allow-list, parsed once. */
  config: ApiTrpcFeatureApplication["config"];
}>;
