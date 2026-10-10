import type { Authorization, AuthorizationPurpose } from "@langwatch/actor";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

/**
 * Mints the own-only proof a fold store's read is fenced by (ADR-144 block
 * C). The store names the tenant from its context and what the read is for;
 * the composition root decides who the proof is minted as, so a store never
 * holds an authorization service of its own.
 */
export type FoldReadAuthorizer = (params: {
  projectId: string;
  purpose: AuthorizationPurpose;
}) => Promise<Authorization>;

/**
 * What a fold store's read is for: the event being folded when the executor
 * named one on the context, else the store entry point, for a read made
 * outside a fold step (a dispatch re-reading committed state).
 */
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
