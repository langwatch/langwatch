/** Kept separate so importing the router/app type never pulls in the installer. */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { SecretApi } from "@langwatch/secret-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createSecretTrpcRouter } from "./secret-trpc.mount.ts";

/** The one namespace this feature mounts, its app slice and its REST families. */
export type ComposedSecretFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    secrets: ReturnType<typeof createSecretTrpcRouter<ApiTrpcContext>>;
  };
  /**
   * For `ctx.app.secrets`, and for every process collaborator that reads a
   * stored value — the gateway's virtual keys, the scenario runner's run
   * parameters and the workflow executor all read through this one app.
   */
  app: SecretApi;
  /**
   * `/api/secret` and `/api/secrets`, each with its `/api/v1` twin. Two
   * declarations because a REST declaration carries exactly one namespace.
   */
  rest: readonly MountableRestApp[];
}>;
