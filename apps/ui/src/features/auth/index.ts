/**
 * The front door, as this application composes it.
 *
 * The eight screens, their transport map and the host port they answer through
 * live in `@langwatch/auth-web`; what belongs to the application is everything
 * they are not allowed to own — the page keys, the deployment's public
 * configuration and the address.
 *
 * NO PERMISSION POLICY, DELIBERATELY. Every other family declares one here;
 * this family is the unauthenticated surface, and a grant it could ask for
 * does not exist yet at the moment these pages render.
 */

import { authApi } from "@langwatch/auth-web/screens/auth";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { authPageLoaders } from "./ui/sections/auth-routes";

export const authApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/auth-web",
  api: authApi,
});

export { authPageLoaders };
