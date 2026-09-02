/**
 * The Workflows family, as this application composes it.
 *
 * The two screens, their dialogs and the chat panel live in
 * `@langwatch/workflow-web`; what belongs to the application is everything they
 * are not allowed to own — which page key each address answers, the permission
 * policy in front of the list, the transport their hooks run on, and the host
 * port that turns this application's capabilities into the questions the family
 * asks.
 */

import { workflowApi } from "@langwatch/workflow-web/screens/workflows";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { workflowPageLoaders } from "./ui/sections/workflows-routes";

export const workflowApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/workflow-web",
  api: workflowApi,
});

export { workflowPageLoaders };
