/**
 * The RBAC settings family, as this application composes it.
 *
 * The two screens live in `@langwatch/authz-web`; what belongs to the
 * application is everything they are not allowed to own — which page keys the
 * addresses answer, the permission guard in front of them, the settings chrome
 * around them, the transport their hooks run on, and the host port that turns
 * this application's capabilities into the questions the family asks.
 */

import { authzApi } from "@langwatch/authz-web/screens/authz";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { authzPageLoaders } from "./ui/sections/authz-routes";

export const authzApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/authz-web",
  api: authzApi,
});

export { authzPageLoaders };
