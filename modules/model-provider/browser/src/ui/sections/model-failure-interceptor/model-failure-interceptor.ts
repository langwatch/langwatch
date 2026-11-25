/**
 * The model-resolution reader the shell runs over every failed mutation, lent
 * the shell's navigation and procedures. specs/model-providers/missing-model-popup.feature.
 */

import type { UiFailureHost } from "@langwatch/browser/feature-install";

import { createModelErrorInterceptor } from "../model-error-interceptor.ts";

/** Reports one failed call as a model-resolution refusal; answers whether it did. */
export function reportModelFailure(error: unknown, { rpc, navigate }: UiFailureHost): boolean {
  return createModelErrorInterceptor({
    navigate,
    clearProjectFeatureModel: async ({ projectId, featureKey }) => {
      await rpc.mutate("modelProvider.setFeatureOverrideForScope", {
        scopeType: "PROJECT",
        scopeId: projectId,
        featureKey,
        model: null,
      });
    },
  })(error);
}
