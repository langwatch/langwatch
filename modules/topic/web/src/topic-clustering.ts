/**
 * The topic family at `/settings/topic-clustering`. A LOADER rather than a
 * component: the screen drags two cards and a run log behind it. The owning
 * frontend feature mounts the tRPC Provider and the host port below it.
 */

import type { ComponentType } from "react";

export type TopicScreenLoader = () => Promise<{ default: ComponentType }>;

export const topicScreens = {
  topicClustering: () => import("./ui/sections/topic-clustering.screen.tsx"),
} as const satisfies Record<string, TopicScreenLoader>;

export type TopicScreenName = keyof typeof topicScreens;

export { TOPIC_CLUSTERING_PAGE_PERMISSION } from "./ui/sections/topic-clustering.screen.tsx";
export { topicApi, type TopicApiMap } from "./behavior/topic-api.ts";
export {
  TopicHostPort,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "./model/topic-host.ts";
