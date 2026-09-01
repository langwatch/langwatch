/**
 * The Ops family, as this application composes it.
 *
 * The fourteen screens and everything they render live in `@langwatch/ops-web`;
 * what belongs to the application is everything they are not allowed to own —
 * which page key each address answers, the permission policy in front of it,
 * the transport their hooks run on, and the host port that turns this
 * application's capabilities into the questions the family asks.
 */

import { opsApi } from "@langwatch/ops-web/screens/ops";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { opsPageLoaders } from "./ui/sections/ops-routes";

export const opsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/ops-web",
  api: opsApi,
});

export { opsPageLoaders };
