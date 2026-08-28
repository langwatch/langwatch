import { createScopeLineageGuard } from "@langwatch/api/trpc";
import type { TRPCContext } from "./trpc.context";

/**
 * The app process's scope-lineage guard. The refusal and its shape are the
 * framework's; what this supplies is the request-scoped authorization service
 * the app composes, which owns the lineage decision and fails closed.
 */
export const scopeLineageGuard = createScopeLineageGuard<TRPCContext>({
  authorization: { forRequest: (ctx) => ctx.app.permissions },
});
