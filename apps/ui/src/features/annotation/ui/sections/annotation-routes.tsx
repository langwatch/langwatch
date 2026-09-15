/**
 * Which page key each annotation view answers, and what it is wrapped in.
 * Only `inbox` carries an explicit `annotations:view` guard — not a gap,
 * every procedure behind all five keys enforces the grant on its own.
 */

import { annotationScreens, type AnnotationView } from "@langwatch/annotation-web/annotations";
import type { UiPageLoader } from "../../../../behavior/ui-page-loaders";
import { lazyRoute } from "../../../../behavior/lazy-route";
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

      return { default: OnView };
    },
    host: AnnotationHost,
    ...(permission ? { permission } : {}),
  });
}

const annotationRoute = (path: string, page: string, loader: UiPageLoader) => ({
  path,
  ...lazyRoute(loader),
  handle: { page },
});

export const annotationPageLoaders: Readonly<Record<string, UiPageLoader>> = {
  "pages/[project]/annotations": annotationPage("inbox", ANNOTATION_PAGE_PERMISSION),
  "pages/[project]/annotations/all": annotationPage("all"),
  "pages/[project]/annotations/me": annotationPage("mine"),
  "pages/[project]/annotations/my-queue": uiPage({
    screen: async () => ({ default: (await import("./annotation-queue-walker")).default }),
    host: AnnotationHost,
  }),
  "pages/[project]/annotations/[slug]": annotationPage("queue"),
};

export const annotationRoutes = [
  annotationRoute(
    "/:project/annotations",
    "pages/[project]/annotations",
    annotationPageLoaders["pages/[project]/annotations"]!,
  ),
  annotationRoute(
    "/:project/annotations/all",
    "pages/[project]/annotations/all",
    annotationPageLoaders["pages/[project]/annotations/all"]!,
  ),
  annotationRoute(
    "/:project/annotations/me",
    "pages/[project]/annotations/me",
    annotationPageLoaders["pages/[project]/annotations/me"]!,
  ),
  annotationRoute(
    "/:project/annotations/my-queue",
    "pages/[project]/annotations/my-queue",
    annotationPageLoaders["pages/[project]/annotations/my-queue"]!,
  ),
  annotationRoute(
    "/:project/annotations/:slug",
    "pages/[project]/annotations/[slug]",
    annotationPageLoaders["pages/[project]/annotations/[slug]"]!,
  ),
];
