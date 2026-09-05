/**
 * The personal workspace: screens in `@langwatch/user-web`. TWO transports —
 * `@langwatch/coding-agent-web`'s tables reach here through `user-web`'s own screen
 * entry, since a governed package may not import it directly.
 */

import {
  codingAgentApi,
  personalWorkspaceApi,
} from "@langwatch/user-web/screens/personal-workspace";
import { uiFeature } from "../../behavior/ui-feature";
import { personalWorkspacePageLoaders } from "./ui/sections/personal-workspace-routes";

export const personalWorkspaceFeature = uiFeature({
  name: "@langwatch/user-web",
  api: personalWorkspaceApi,
  loaders: personalWorkspacePageLoaders,
});

export const codingAgentFeature = uiFeature({
  name: "@langwatch/coding-agent-web",
  api: codingAgentApi,
});
