/**
 * The server half of `gatewaySpendEvents.*`: a thin handler over
 * {@link GatewayApi.findSpendEventsPage}, which does the whole assembly
 * (page read, organization resolution, key-name resolution, the
 * `occurredAt` to `Date` conversion) and answers `null` when this
 * deployment has no ClickHouse spend source.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GatewayApi, gatewaySpendEventTrpc } from "@langwatch/gateway-contract";

export const gatewaySpendEventTrpcTransport = defineTrpcRouter(GatewayApi, gatewaySpendEventTrpc)
  .procedure("list")
  .withPermission("gatewayUsage:view")
  .handle(async ({ app, input }) => {
    const page = await app.findSpendEventsPage(input);
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
