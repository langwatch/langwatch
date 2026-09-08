import type { ComponentType } from "react";
import type { AnnotationView } from "./model/annotation-view.ts";

export type AnnotationScreenLoader = () => Promise<{
  default: ComponentType<{ view: AnnotationView }>;
}>;

export const annotationScreens = {
  annotations: () => import("./ui/sections/annotations-screen.tsx"),
} as const satisfies Record<string, AnnotationScreenLoader>;

export type AnnotationScreenName = keyof typeof annotationScreens;

export { annotationApi } from "./behavior/annotation-api.ts";
export { annotationViewCopy } from "./model/annotation-view.ts";
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
} from "./model/annotation-host.ts";

export { useAnnotationQueues } from "./behavior/use-annotation-queues.ts";
export { useShowErrorToast } from "./behavior/use-error-toast.ts";
export { default as AnnotationQueueLayout } from "./ui/sections/annotation-queue-layout.tsx";
export { TasksDone } from "./ui/elements/tasks-done-icon.tsx";
export type { RouterOutputs } from "./behavior/annotation-api.ts";
