/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { UserApi } from "@langwatch/user-contract";
import type { IdentityTrpcPorts, UserTrpcPorts } from "@langwatch/user-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type { createIdentityTrpcRouter, createUserTrpcRouter } from "./user-trpc.mount.ts";

/** The two namespaces this feature mounts, and the slices behind them. */
export type ComposedUserFeature = Readonly<{
  /** The `ctx.app.users` slice. */
  app: UserApi;
  /**
   * The operator allow-list this deployment names, in the shape `ctx.app.ops`
   * carries. Published for the retention gate, so "who may keep data forever"
   * and "who sees the operator sidebar" are never two answers.
   */
  ops: ApiTrpcFeatureApplication["ops"];
  /** The `ctx.app.config` slice: the same allow-list, parsed once. */
  config: ApiTrpcFeatureApplication["config"];
  /**
   * The two port groups the namespaces are built on.
   */
  ports: Readonly<{ identity: IdentityTrpcPorts; user: UserTrpcPorts }>;
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    identity: ReturnType<typeof createIdentityTrpcRouter>;
    user: ReturnType<typeof createUserTrpcRouter>;
  }>;
}>;
