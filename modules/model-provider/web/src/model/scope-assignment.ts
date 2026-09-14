/**
 * Which tier a configuration row targets, and the id of the thing it points at. ADR-021's
 * canonical shape, restated here (not imported from `platform/app`'s Zod schema, which a browser
 * package may not reach) since nothing here parses one — the scope picker hands it over already
 * validated and the server re-parses at the boundary.
 */

import type { ModelProviderScopeType } from "@langwatch/model-provider-contract";

export type ScopeAssignment = {
  scopeType: ModelProviderScopeType;
  scopeId: string;
};
