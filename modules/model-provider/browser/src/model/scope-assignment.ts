/**
 * Which tier a configuration row targets, and the id it points at. ADR-021's
 * canonical shape, restated here (a browser package can't import
 * `platform/app`'s schema) since the scope picker hands it over pre-validated.
 */

import type { ModelProviderScopeType } from "@langwatch/model-provider-contract";

export type ScopeAssignment = {
  scopeType: ModelProviderScopeType;
  scopeId: string;
};
