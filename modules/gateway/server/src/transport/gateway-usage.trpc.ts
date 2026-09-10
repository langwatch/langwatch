/**
 * The server half of `gatewayUsage.*`. Neither procedure holds a fixed
 * permission: the keys a caller may total over are data the resolver loads, so
 * the membership filter inside it is the check, declared as such.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  GatewayApi,
  gatewayUsageTrpc,
  VirtualKeyNotFoundError,
} from "@langwatch/gateway-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

/** The window a caller asked for, as the usage reader takes it. */
function usageWindow(input: { fromDate: string; toDate: string }) {
  return {
    fromDate: Temporal.Instant.fromEpochMilliseconds(toEpochMs(input.fromDate)),
    toDate: Temporal.Instant.fromEpochMilliseconds(toEpochMs(input.toDate)),
  };
}

export const gatewayUsageTrpcTransport = defineTrpcRouter(GatewayApi, gatewayUsageTrpc)
  // Membership-based like virtualKeys.list: the summary totals the keys the
  // caller can see, so its numbers reconcile with the table a click arrives
  // from. A non-member sees no keys and gets an empty summary.
  .procedure("summary")
  .serviceAuthorized({
    reason:
      "usage is summed only over the keys the caller's membership in this organization makes visible; the membership filter in the resolver is the check",
    permissions: ["gatewayUsage:view"],
  })
  .handle(async ({ app, input, actor }) => {
    const keys = await app.listVisibleVirtualKeys({
      organizationId: input.organizationId,
      userId: actor.id,
    });

    return app.usageSummary({
      organizationId: input.organizationId,
      virtualKeyIds: keys.map((k) => k.id),
      window: usageWindow(input),
    });
  })

  .procedure("summaryForVirtualKey")
  .serviceAuthorized({
    reason:
      "the key is loaded within this organization and must be visible to the caller's membership set; a miss is answered as not found",
    permissions: ["gatewayUsage:view"],
  })
  .handle(async ({ app, input, actor }) => {
    // Same visibility rule as virtualKeys.get: a key the caller cannot see is
    // indistinguishable from one that does not exist.
    const vk = await app.findVirtualKeyById(input.virtualKeyId, input.organizationId);
    if (!vk) throw new VirtualKeyNotFoundError();

    const visible = await app.isVirtualKeyVisible({
      organizationId: input.organizationId,
      userId: actor.id,
      virtualKey: vk,
    });
    if (!visible) throw new VirtualKeyNotFoundError();

    return app.usageSummaryForVirtualKey({
      organizationId: input.organizationId,
      virtualKeyId: input.virtualKeyId,
      window: usageWindow(input),
      model: input.model,
    });
  })
  .build();
