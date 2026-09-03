/**
 * The topic family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/topic-clustering`.
 *
 * WHY THIS PACKAGE. The data-governance family's rule, read strictly: a key
 * belongs to the family that owns its TRANSPORT. `topics.getClusteringStatus`
 * and `topics.getClusteringRunHistory` are mounted from
 * `@langwatch/topic-server` and every payload the page renders is
 * `@langwatch/topic-contract`'s. The one procedure that is not this feature's —
 * `project.triggerTopicClustering` — is a door into the same run, addressed by
 * its string like every other borrowed mount point.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project and the
 * two notices.
 */

import type { ComponentType } from "react";

export type TopicScreenLoader = () => Promise<{ default: ComponentType }>;

export const topicScreens = {
  topicClustering: () => import("./topic-clustering.screen"),
} as const satisfies Record<string, TopicScreenLoader>;

export type TopicScreenName = keyof typeof topicScreens;

export { TOPIC_CLUSTERING_PAGE_PERMISSION } from "./topic-clustering.screen";
export { topicApi, type TopicApiMap } from "../../behavior/topic-api";
export {
  TopicHostPort,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "../../model/topic-host";
