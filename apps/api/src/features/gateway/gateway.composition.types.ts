/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type { ApiGatewayComposition } from "../../app/api-gateway.composition.ts";

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
}>;
