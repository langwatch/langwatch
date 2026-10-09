import type { Authorization, AuthorizationPurpose } from "@langwatch/authorization";

import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

/**
 * Mints the own-only proof a fold store's read is fenced by (ADR-177 block C). The store names
 * the tenant and the purpose; the composition root decides who the proof is minted as.
 */
export type FoldReadAuthorizer = (params: {
  projectId: string;
  purpose: AuthorizationPurpose;
}) => Promise<Authorization>;

/** The event being folded when the executor named one, else the store entry outside a fold. */
export function foldReadPurpose({
  context,
  entry,
}: {
  context: ProjectionStoreContext;
  entry: string;
}): AuthorizationPurpose {
  return context.eventId !== undefined
    ? { kind: "event", eventId: context.eventId }
    : { kind: "operator", entry };
}
