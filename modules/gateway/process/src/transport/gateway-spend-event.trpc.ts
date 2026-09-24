/**
 * The server half of `gatewaySpendEvents.*`: a thin handler over
 * {@link GatewayApi.listSpendEventsPage}, which does the whole assembly and
 * answers `null` when this deployment has no ClickHouse spend source.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GatewayApi, gatewaySpendEventTrpc } from "@langwatch/gateway-contract";

export const gatewaySpendEventTrpcTransport = defineTrpcRouter(GatewayApi, gatewaySpendEventTrpc)
  .procedure("list")
  .withPermission("gatewayUsage:view")
  .handle(async ({ app, input }) => {
    const page = await app.listSpendEventsPage(input);
    return (
      page ?? {
        rows: [],
        nextCursor: null,
        virtualKeyNames: {},
        clickHouseDisabled: true,
      }
    );
  })
  .build();
