/**
 * The server half of `gatewaySpendEvents.*`: a thin handler over
 * {@link GatewayApi.listSpendEventsPage}, which does the whole assembly and
 * answers an empty, flagged page when this deployment has no ClickHouse spend source.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { GatewayApi, gatewaySpendEventTrpc } from "@langwatch/gateway-contract";

export const gatewaySpendEventTrpcTransport: TrpcRouterDeclaration<
  GatewayApi,
  typeof gatewaySpendEventTrpc
> = defineTrpcRouter(GatewayApi, gatewaySpendEventTrpc)
  .procedure("list")
  .withPermission("gatewayUsage:view")
  .handle(({ app, input }) => app.listSpendEventsPage(input))
  .build();
