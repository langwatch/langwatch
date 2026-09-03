/**
 * The API Key family, as this application composes it.
 *
 * The two screens live in `@langwatch/api-key-web`; what belongs to the
 * application is everything they are not allowed to own — which page keys the
 * addresses answer, the settings chrome around one of them, the transport their
 * hooks run on, the host port that turns this application's capabilities into
 * the questions the family asks, and the CLI device-flow wire the published
 * `langwatch` binary is on the other side of.
 */

import { apiKeyApi } from "@langwatch/api-key-web/screens/api-key";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { apiKeyPageLoaders } from "./ui/sections/api-key-routes";

export const apiKeyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/api-key-web",
  api: apiKeyApi,
});

export { apiKeyPageLoaders };
