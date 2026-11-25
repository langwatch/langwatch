/**
 * What a browser installs when it installs feature-flag: no screen of its
 * own — ops mounts the operator catalogue view inline.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";

export const featureFlagWeb = defineBrowserModule("feature-flag").provides(UiFlagsService, {
  load: () => import("./behavior/ui-flags-source.ts"),
});
