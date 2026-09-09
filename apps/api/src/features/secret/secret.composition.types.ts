/** Kept separate so importing the router/app type never pulls in the installer. */
import type { SecretApi } from "@langwatch/secret-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createSecretTrpcRouter } from "./secret-trpc.mount.ts";

/**
 * The one namespace this feature mounts and its app slice. `/api/secret` and
 * `/api/secrets` are opened from the door registry over this same application.
 */
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
}>;
