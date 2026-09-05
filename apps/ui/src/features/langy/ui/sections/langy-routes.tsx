/**
 * Which page key the Langy layout route answers: a layout key, not a page
 * key — kept mounted while pages below it swap, which is how the dock keeps
 * one conversation across a navigation. The outlet is this application's.
 */

import { ProjectLangyLayout } from "@langwatch/langy-web/screens/langy";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { UiRouteOutlet } from "../../../../ui/sections/ui-route-objects";
import { LangyHost } from "./host";

function ProjectLangyLayoutRoute() {
  return (
    <ProjectLangyLayout>
      <UiRouteOutlet />
    </ProjectLangyLayout>
  );
}

export const langyPageLoaders: UiPageLoaderRegistry = {
  "features/langy/ProjectLangyLayout": uiPage({
    screen: async () => ({ default: ProjectLangyLayoutRoute }),
    host: LangyHost,
  }),
};
