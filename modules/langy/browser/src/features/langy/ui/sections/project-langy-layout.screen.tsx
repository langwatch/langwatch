import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";

import ProjectLangyLayout from "./project-langy-layout.tsx";

/**
 * The `layouts/project-langy` route: Langy mounted once above whichever
 * project page the router draws below it.
 */
export default function ProjectLangyLayoutScreen() {
  return (
    <ProjectLangyLayout>
      <UiRouteOutlet />
    </ProjectLangyLayout>
  );
}
