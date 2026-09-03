/**
 * Front door: eight screens in `@langwatch/auth-web`. NO permission policy,
 * deliberately — this is the unauthenticated surface, and no grant exists
 * yet when these pages render.
 */

import { authApi } from "@langwatch/auth-web/screens/auth";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { authPageLoaders } from "./ui/sections/auth-routes";

export const authApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/auth-web",
  api: authApi,
});

export { authPageLoaders };
