import {
  emptyGrantsLedgerState,
  type GrantsLedgerState,
  reduceGrantsLedger,
} from "@langwatch/authz-server";
import type { StateProjectionDefinition } from "../../../projections";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import { AUTHZ_GRANTS_EVENT_TYPES } from "../schemas/constants";
import {
  type AuthzGrantsEvent,
  authzGrantsEventSchema,
} from "../schemas/events";
import { wireEventToFact } from "./wireToFact";

export const AUTHZ_GRANTS_PROJECTION_VERSION = "2026-08-17" as const;

/**
 * The grants ledger's operational projection (ADR-092 §13): one Postgres
 * state per organization, applied through `.withProjection()`'s direct
 * load/apply/store cycle under the queue's per-org lock (ADR-049 shape).
 *
 * `apply` validates the wire event, reshapes it (wireToFact), and hands it
 * to the pure reducer in `@langwatch/authz-server` — live dispatch and the
 * replay test run the identical function, which is what makes replay
 * determinism a meaningful proof. The store writes both heads (Grant/Role
 * and the legacy-shaped compat rows) plus the cursor; see the repository.
 */
export function createAuthzGrantsStateProjection({
  store,
}: {
  store: StateProjectionStore<GrantsLedgerState>;
}): StateProjectionDefinition<GrantsLedgerState, AuthzGrantsEvent> {
  return {
    name: "authzGrantsState",
    version: AUTHZ_GRANTS_PROJECTION_VERSION,
    eventTypes: AUTHZ_GRANTS_EVENT_TYPES,
    init: () => emptyGrantsLedgerState({ organizationId: "" }),
    apply: (state, event) => {
      const parsed = authzGrantsEventSchema.parse(event);
      const next = reduceGrantsLedger({
        state,
        event: wireEventToFact(parsed),
      });
      // init() cannot know the organization; the first applied event does.
      return next.organizationId === ""
        ? { ...next, organizationId: parsed.aggregateId }
        : next;
    },
    store,
  };
}
