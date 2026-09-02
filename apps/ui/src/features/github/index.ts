/**
 * The Integrations family, as this application composes it.
 *
 * The screen, its installation row and the install address live in
 * `@langwatch/github-web`; what belongs to the application is everything they
 * are not allowed to own — the page key, the permission policy, the settings
 * chrome, the transport, and the host port that turns this application's
 * capabilities into the questions the family asks.
 */

import { githubApi } from "@langwatch/github-web/screens/integrations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { githubPageLoaders } from "./ui/sections/github-routes";

export const githubApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/github-web",
  api: githubApi,
});

export { githubPageLoaders };
