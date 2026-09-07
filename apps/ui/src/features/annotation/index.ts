import { annotationApi } from "@langwatch/annotation-web/screens/annotations";
import type { WebInstallation } from "../../behavior/ui-web-installation";
import { uiApiBinding } from "../../behavior/ui-feature";
import { annotationRoutes } from "./ui/sections/annotation-routes";

export const annotationWeb: WebInstallation = {
  name: "annotation",
  install(ui) {
    ui.routes("project", annotationRoutes);
    ui.api(uiApiBinding("@langwatch/annotation-web", annotationApi));
  },
};
