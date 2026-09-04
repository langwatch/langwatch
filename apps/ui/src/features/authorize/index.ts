/**
 * Handoff: two screens in `@langwatch/api-key-web`. NO API binding of its
 * own — the one read is `organization.getAll` on `features/api-key`'s
 * already-installed `apiKeyApi`.
 */

import { uiFeature } from "../../behavior/ui-feature";
import { authorizePageLoaders } from "./ui/sections/authorize-routes";

export const authorizeFeature = uiFeature({
  name: "@langwatch/ui/features/authorize",
  loaders: authorizePageLoaders,
});
