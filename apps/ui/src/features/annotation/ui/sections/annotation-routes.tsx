/**
 * Which page key each annotation view answers, and what it is wrapped in.
 *
 * FOUR KEYS, ONE SCREEN. `platform/app` had four page files under
 * `/:project/annotations` whose bodies differed only in the props they handed
 * one table; the package exposes one screen, and this is the map between the
 * two vocabularies. It makes the view explicit — a key names a view here, so
 * the screen is told rather than having to read the address back. The
 * automations family's tab-as-prop shape, applied to a list.
 *
 * THE FIFTH KEY LANDED. `pages/[project]/annotations/my-queue` was recorded as
 * staying behind because the queue walker mounts the trace family's
 * conversation view, "which no package publishes". The traces family moved that
 * tree into `@langwatch/trace-web` afterwards, so the walker moved with it — and
 * `platform/app`'s `AnnotationsLayout` and `useAnnotationQueues`, which were
 * alive only for this one page, are deleted rather than moved.
 *
 * The walker takes the same host as the other four and mounts the TRACE host
 * itself, inside the package: `ConversationView` and `useConversationTurns` ask
 * `@langwatch/trace-web`'s port for the project their turns belong to, and
 * answering that from the annotation host keeps this application mounting one
 * host per page.
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the annotation host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy
 * the platform higher-order component carried.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND ONLY ONE OF THE FOUR HAD
 * ONE. `annotations.tsx` was `withPermissionGuard("annotations:view")`;
 * `all.tsx`, `me.tsx` and `[slug].tsx` were wrapped in nothing at all. The
 * asymmetry is carried rather than tidied, because inventing a guard is a
 * change to who can reach a page and a page move does not own that decision —
 * the datasets family's ruling, applied the other way round. It is not a hole:
 * every procedure behind all four keys carries `annotations:view` as its own
 * policy, so a reader without the grant meets an empty page whose reads all
 * refused rather than data they should not see. RECORDED so whoever owns
 * annotations permissions can decide whether the three unguarded keys should
 * state it, which is a security question and not this move's.
 *
 * `layoutComponent: DashboardLayout` was the other half of the inbox page's
 * call and does not travel — chrome belongs to the route tree, and these pages
 * are children of a layout route the composing application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import {
  annotationScreens,
  type AnnotationView,
} from "@langwatch/annotation-web/screens/annotations";
import { myQueueScreens } from "@langwatch/annotation-web/screens/my-queue";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { ANNOTATION_PAGE_PERMISSION } from "../../behavior/annotation-host.adapter";
import { withAnnotationHost } from "./annotation-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

function annotationPage(view: AnnotationView, permission?: string): UiPageLoader {
  return async () => {
    const module = await annotationScreens.annotations();
    const Screen = module.default;
    const OnView = () => <Screen view={view} />;
    OnView.displayName = `AnnotationsPage(${view})`;
    const guarded = withUiPageGuard({
      ...(permission ? { permission } : {}),
      fallbacks: FALLBACKS,
    })(OnView as ComponentType);
    return { default: withAnnotationHost(guarded) };
  };
}

/**
 * The walker takes no guard, which is `platform/app`'s own policy for it: the
 * page was wrapped in nothing, and every read behind it is the reviewer's own
 * queue work.
 */
const myQueuePage: UiPageLoader = async () => {
  const module = await myQueueScreens.myQueue();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default);
  guarded.displayName = "AnnotationQueueWalker";
  return { default: withAnnotationHost(guarded) };
};

export const annotationPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/annotations": annotationPage("inbox", ANNOTATION_PAGE_PERMISSION),
  "pages/[project]/annotations/me": annotationPage("mine"),
  "pages/[project]/annotations/all": annotationPage("all"),
  "pages/[project]/annotations/[slug]": annotationPage("queue"),
  "pages/[project]/annotations/my-queue": myQueuePage,
};
