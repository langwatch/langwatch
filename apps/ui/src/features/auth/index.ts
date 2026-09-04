/**
 * Front door: eight screens in `@langwatch/auth-web`. NO permission policy,
 * deliberately — this is the unauthenticated surface, and no grant exists
 * yet when these pages render.
 */

import { authApi } from "@langwatch/auth-web/screens/auth";
import { uiFeature } from "../../behavior/ui-feature";
import { authPageLoaders } from "./ui/sections/auth-routes";

export const authFeature = uiFeature({
  name: "@langwatch/auth-web",
  api: authApi,
  loaders: authPageLoaders,
});
