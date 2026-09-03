/**
 * Which page key the Langy layout route answers.
 *
 * A LAYOUT key, not a page key — the same shape `features/chrome/UiAppChrome`
 * takes: the two route-table entries that name it carry children and no path,
 * so React Router keeps it mounted while the pages below it swap. That is the
 * whole reason the dock keeps one conversation, one open panel and one live
 * turn across a navigation, and it is what `specs/langy/langy-navigation-persistence.feature`
 * pins.
 *
 * THE OUTLET IS THIS APPLICATION'S. `@langwatch/langy-web` renders the layout
 * around whatever it is given; which router is below it is the composition's
 * business, and `react-router` is sealed off from a feature package's screens
 * anyway. So the package's layout takes children, and this supplies them.
 */

import { ProjectLangyLayout } from "@langwatch/langy-web/screens/langy-layout";
import { Outlet } from "react-router";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { LangyHost } from "./host";

function ProjectLangyLayoutRoute() {
  return (
    <ProjectLangyLayout>
      <Outlet />
    </ProjectLangyLayout>
  );
}

export const langyPageLoaders: UiPageLoaderRegistry = {
  "features/langy/ProjectLangyLayout": uiPage({
    screen: async () => ({ default: ProjectLangyLayoutRoute }),
    host: LangyHost,
  }),
};
