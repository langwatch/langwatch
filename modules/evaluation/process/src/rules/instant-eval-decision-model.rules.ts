/**
 * The judge leaf's view of a project's own decision model, from model provider's answer
 * (ADR-182 decision 6). Every caller of the leaf maps it the same way.
 */

import type { InstantEvalOwnDecisionModel } from "@langwatch/instant-eval-judge-contract";
import type { DecisionModelResolution } from "@langwatch/model-provider-contract";

export function ownDecisionModelOf(
  resolved: Extract<DecisionModelResolution, { kind: "own" }>,
): InstantEvalOwnDecisionModel {
  const { model, wire, providerModel, endpoint, apiKey } = resolved;
  return { model, wire, providerModel, endpoint, apiKey };
}

/** The skip an own decision model that cannot run is answered with; never LangWatch's classifier. */
export function unavailableDecisionModelSkipOf(
  resolved: Extract<DecisionModelResolution, { kind: "own_unavailable" }>,
): "classifier_not_configured" | "classifier_key_invalid" {
  return resolved.reason === "not_enabled" ? "classifier_not_configured" : "classifier_key_invalid";
}
