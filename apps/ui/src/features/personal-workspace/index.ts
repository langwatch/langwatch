/**
 * The personal workspace: screens in `@langwatch/user-web`. TWO transports
 * — `@langwatch/coding-agent-web`'s tables reach here through `user-web`'s
 * own screen entry, since a governed package may not import it directly.
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
