/**
 * AI Governance, as this application composes it.
 *
 * The screens live in `@langwatch/enterprise-governance-web`; what belongs to
 * the application is everything the screens are not allowed to own — which page
 * key each answers, the flag and permission policy in front of them, the
 * transport their hooks run on, and the host port that turns this application's
 * capabilities into the four questions the section asks.
 */

import { governanceApi } from "@langwatch/enterprise-governance-web/screens/governance";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { governancePageLoaders } from "./ui/sections/governance-routes";

export const governanceApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-governance-web",
  api: governanceApi,
});

export { governancePageLoaders };
