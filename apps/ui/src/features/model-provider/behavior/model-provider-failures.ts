/**
 * What this application does when any mutation fails on a model it could not
 * resolve, could not reach, or resolved to a disabled provider.
 */

import { createModelErrorInterceptor } from "@langwatch/model-provider-web/surfaces/model-error-interceptor";
import type { UiFailureInterceptor } from "../../../behavior/ui-feature";

/** The procedure that clears one scope's feature override. */
const SET_FEATURE_OVERRIDE = "modelProvider.setFeatureOverrideForScope";

export const modelProviderFailures: UiFailureInterceptor = (error, { rpc, navigate }) =>
  createModelErrorInterceptor({
    navigate,
    // Clearing the project's own key is what makes the next resolve fall
    // through to the parent scope's default, which is the swap the toast offers.
    clearProjectFeatureModel: async ({ projectId, featureKey }) => {
      await rpc.mutate(SET_FEATURE_OVERRIDE, {
        scopeType: "PROJECT",
        scopeId: projectId,
        featureKey,
        model: null,
      });
    },
  })(error);
