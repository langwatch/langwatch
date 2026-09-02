/**
 * The annotations family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes is a
 * LOADER rather than a component, because the screen drags the table, the send
 * dialog, the queue editor and the participants picker behind it, and none of
 * that belongs in the chunk that renders the rest of the application.
 *
 * ONE SCREEN, FOUR ADDRESSES: `/:project/annotations`, `/annotations/me`,
 * `/annotations/all` and `/annotations/:slug`. `platform/app` had four page
 * files that differed only in the props they handed one table; the map from a
 * page key to a VIEW is `apps/ui`'s to make, and the view names travel with the
 * loader so that mapping can be written in this package's own vocabulary. The
 * automations family's tab-as-prop shape, applied to a list.
 *
 * THE FIFTH ADDRESS, `/annotations/my-queue`, IS NOT HERE. It mounts the trace
 * family's conversation view, which no package publishes; it stays in
 * `platform/app` and moves with traces. Every link this screen writes to it is
 * a plain navigation, so it keeps working across the seam.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * project, the reviewer, their grants and membership, the address and the two
 * notices.
 */

import type { ComponentType } from "react";
import type { AnnotationView } from "../../model/annotation-view";

/**
 * The screen takes its VIEW as a prop, so the loader's module type says so.
 * `apps/ui` binds the view per page key and hands React Router a component that
 * takes none.
 */
export type AnnotationScreenLoader = () => Promise<{
  default: ComponentType<{ view: AnnotationView }>;
}>;

export const annotationScreens = {
  annotations: () => import("./annotations.screen"),
} as const satisfies Record<string, AnnotationScreenLoader>;

export type AnnotationScreenName = keyof typeof annotationScreens;

export { annotationApi } from "../../behavior/annotation-api";
export { annotationViewCopy } from "../../model/annotation-view";
export type { AnnotationView };
export {
  AnnotationHostPort,
  AnnotationHostProvider,
  useAnnotationHost,
  type AnnotationFailureNotice,
  type AnnotationHostProject,
  type AnnotationHostUser,
  type AnnotationRouteReading,
  type AnnotationSuccessNotice,
} from "../../model/annotation-host";
