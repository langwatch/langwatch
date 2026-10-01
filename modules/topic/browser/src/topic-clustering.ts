/**
 * The topic family at `/settings/topic-clustering`. A LOADER rather than a
 * component: the screen drags two cards and a run log behind it. The owning
 * frontend feature mounts the tRPC Provider and the host port below it.
 */

export { topicApi, type TopicApiMap } from "./behavior/topic-api.ts";
export {
  TOPIC_CLUSTERING_PAGE_PERMISSION,
  TopicHostApi,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "./model/topic-host.ts";
