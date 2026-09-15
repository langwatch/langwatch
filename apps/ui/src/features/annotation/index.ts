import { annotationApi } from "@langwatch/annotation-web/annotations";
import { personalWorkspaceFeaturesApi } from "@langwatch/organization-web/personal-workspace-features";
import type { WebInstallation } from "../../behavior/ui-web-installation";
import { uiApiBinding } from "../../behavior/ui-feature";
import { annotationRoutes } from "./ui/sections/annotation-routes";

export const annotationWeb: WebInstallation = {
  name: "annotation",
  install(ui) {
    ui.routes("project", annotationRoutes);
    ui.api(uiApiBinding("@langwatch/annotation-web", annotationApi));

    ui.api(
      uiApiBinding(
        "@langwatch/organization-web/personal-workspace-features",
        personalWorkspaceFeaturesApi,
      ),
    );
  },
};
