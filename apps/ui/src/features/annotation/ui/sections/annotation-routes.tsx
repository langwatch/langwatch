/**
 * Which page key each annotation view answers, and what it is wrapped in.
 * Only `inbox` carries an explicit `annotations:view` guard — not a gap,
 * every procedure behind all five keys enforces the grant on its own.
 */

import {
  annotationScreens,
  type AnnotationView,
} from "@langwatch/annotation-web/screens/annotations";
import { myQueueScreens } from "@langwatch/annotation-web/screens/my-queue";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AnnotationHost } from "./annotation-host";

/** The grant the platform inbox page asked for, unchanged. */
const ANNOTATION_PAGE_PERMISSION = "annotations:view";

function annotationPage(view: AnnotationView, permission?: string): UiPageLoader {
  return uiPage({
    screen: async () => {
      const Screen = (await annotationScreens.annotations()).default;
      const OnView = () => <Screen view={view} />;
      OnView.displayName = `AnnotationsPage(${view})`;
      return { default: OnView as ComponentType };
    },
    host: AnnotationHost,
    ...(permission ? { permission } : {}),
  });
}

export const annotationPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/annotations": annotationPage("inbox", ANNOTATION_PAGE_PERMISSION),
  "pages/[project]/annotations/me": annotationPage("mine"),
  "pages/[project]/annotations/all": annotationPage("all"),
  "pages/[project]/annotations/[slug]": annotationPage("queue"),
  "pages/[project]/annotations/my-queue": uiPage({
    screen: async () => ({ default: (await myQueueScreens.myQueue()).default }),
    host: AnnotationHost,
  }),
};
