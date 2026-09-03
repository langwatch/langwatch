/**
 * Which page key each annotation view answers, and what it is wrapped in.
 *
 * FOUR KEYS, ONE SCREEN. `platform/app` had four page files under
 * `/:project/annotations` whose bodies differed only in the props they handed
 * one table; the package exposes one screen, and this is the map between the
 * two vocabularies. The automations family's tab-as-prop shape, applied to a
 * list.
 *
 * The walker takes the same host as the other four and mounts the TRACE host
 * itself, inside the package: `ConversationView` and `useConversationTurns` ask
 * `@langwatch/trace-web`'s port for the project their turns belong to, and
 * answering that from the annotation host keeps this application mounting one
 * host per page.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND ONLY ONE OF THE FOUR HAD
 * ONE: `annotations.tsx` was `withPermissionGuard("annotations:view")`; the
 * other three, and the queue walker, were wrapped in nothing at all. The
 * asymmetry is carried rather than tidied — inventing a guard is a change to
 * who can reach a page, which a page move does not own. It is not a hole:
 * every procedure behind all four keys carries `annotations:view` as its own
 * policy, so a reader without the grant meets an empty page whose reads all
 * refused rather than data they should not see.
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
