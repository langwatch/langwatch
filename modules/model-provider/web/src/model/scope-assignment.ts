/**
 * Which tier a configuration row targets, and the id of the thing it points at.
 *
 * ADR-021's canonical shape, camelCase end to end. `platform/app` declared it in
 * `src/server/scopes/scope.types.ts` behind a Zod schema, which a browser
 * package may not import — and does not need to: nothing here parses one, the
 * scope picker hands them over already validated and the server re-parses them
 * at the boundary.
 *
 * The same three tiers `ModelProviderScopeType` names, restated as the pair
 * rather than as the tier alone, because every caller carries both halves.
 */

import type { ModelProviderScopeType } from "@langwatch/model-provider-contract";

export type ScopeAssignment = {
  scopeType: ModelProviderScopeType;
  scopeId: string;
};
