/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { ApiGatewayComposition } from "../../app/api-gateway.composition";
import type { createGatewayTrpcRouters } from "./gateway-trpc.mount";

/** What the gateway's three kinds of door are given. */
export type ComposedGatewayFeature = Readonly<{
  /** The `ctx.app.gateway` slice, and what the two REST families are handed. */
  app: ApiTrpcFeatureApplication["gateway"];
  /**
   * Everything the composition opened, for the two doors that need more than the
   * application: the billing reconciliation family walks the spend store directly, and
   * the Go data plane materialises a key's warm-cache bundle against the decision store.
   */
  composition: ApiGatewayComposition | undefined;
  /** The six namespaces, built on the process's own root. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createGatewayTrpcRouters>;
}>;
