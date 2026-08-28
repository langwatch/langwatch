import { TrpcRootDefinition } from "@langwatch/api/trpc";
import superjson from "superjson";
import type { TRPCContext } from "./trpc.context";
import { errorFormatter } from "./trpc.error-formatter";

/**
 * The one app-owned tRPC initializer. Router fragments consume its typed
 * builders; feature packages must not create parallel roots with partial
 * middleware policy.
 */
export const appTrpcRoot = TrpcRootDefinition.forContext<TRPCContext>().create({
  transformer: superjson,
  errorFormatter,
});

export const createTRPCRouter = appTrpcRoot.router;
