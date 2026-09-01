/**
 * The personal workspace, as this application composes it.
 *
 * The screens live in `@langwatch/user-web`; what belongs to the application is
 * everything the screens are not allowed to own — which page key each answers,
 * the flag policy in front of them, the browser tab's title, the
 * last-home marker, the transports their hooks run on, and the host port that
 * turns this application's capabilities into the questions the family asks.
 *
 * TWO transports rather than one, which is what makes this feature different
 * from the gateway's and the governance section's. The sessions and
 * pull-request screens render tables from `@langwatch/coding-agent-web`, which
 * calls procedures of its own; that package is not a governed web package, so
 * this feature may not import it, and its api object reaches here through the
 * screen entry of the package that does render its tables.
 */

import {
  codingAgentApi,
  personalWorkspaceApi,
} from "@langwatch/user-web/screens/personal-workspace";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { personalWorkspacePageLoaders } from "./ui/sections/personal-workspace-routes";

export const personalWorkspaceApiBindings: readonly UiFeatureApiBinding[] = [
  uiFeatureApi({ name: "@langwatch/user-web", api: personalWorkspaceApi }),
  uiFeatureApi({ name: "@langwatch/coding-agent-web", api: codingAgentApi }),
];

export { personalWorkspacePageLoaders };
