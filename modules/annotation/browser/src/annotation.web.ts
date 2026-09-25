/**
 * What a browser installs when it installs annotation: the five screens the
 * product routes today, the surfaces other modules mount, and the one
 * injected value these screens are allowed to read.
 */

import { defineWebModule } from "@langwatch/ui-kernel";
import { createElement } from "react";
import { z } from "zod";

import type { AnnotationView } from "./model/annotation-view.ts";

/**
 * The four lists are one screen under four addresses — the view is part of
 * the route, which is why the module binds it here rather than shipping four
 * page files that differ by one prop.
 */
function annotationList(view: AnnotationView) {
  return async () => {
    const { AnnotationsScreen } = await import("./ui/sections/annotations-screen.tsx");

    return { default: () => createElement(AnnotationsScreen, { view }) };
  };
}

export const annotationWeb = defineWebModule("annotation")
  .withHosts({
    requires: ["AnnotationHostApi", "AnnotationScoresHostApi"],
    mounts: {
      AnnotationHostApi: { load: () => import("./behavior/annotation-host-mount.tsx") },
      AnnotationScoresHostApi: {
        load: () => import("./behavior/annotation-scores-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    "pages/[project]/annotations": {
      path: "/:project/annotations",
      within: "project",
      label: "Annotations",
      load: annotationList("inbox"),
    },
    "pages/[project]/annotations/all": {
      path: "/:project/annotations/all",
      within: "project",
      load: annotationList("all"),
    },
    "pages/[project]/annotations/me": {
      path: "/:project/annotations/me",
      within: "project",
      load: annotationList("mine"),
    },
    "pages/[project]/annotations/[slug]": {
      path: "/:project/annotations/:slug",
      within: "project",
      load: annotationList("queue"),
    },
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/annotation-scores": {
      path: "/settings/annotation-scores",
      within: "settings",
      label: "Annotation Scores",
      load: () => import("./ui/sections/annotation-scores-screen.tsx"),
    },
  })
  /** What another module may mount. Today the trace explorer mounts all four. */
  .publishSurfaces({
    "annotation-card": { load: () => import("./annotation-card.ts") },
    "annotation-chips": { load: () => import("./annotation-chips.ts") },
    "annotation-form": { load: () => import("./annotation-form.ts") },
    "annotation-scores": { load: () => import("./annotation-scores.ts") },
  })
  /**
   * The deployment mode decides which documentation host an annotation screen
   * links into, read off the process owner's slice. The supply parses it before
   * a component renders, and refuses the boot naming this module.
   */
  .withConfig({ process: z.object({ mode: z.enum(["development", "test", "production"]) }) });
