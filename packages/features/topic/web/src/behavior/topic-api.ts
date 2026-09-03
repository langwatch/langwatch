/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/topic-server` and `@langwatch/project-server`, which a web
 * package may not import even for a type, and the router type does not exist
 * until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `topics` and `project` are mount points
 * on the root router and tRPC hashes that path into the React Query cache key;
 * spell either differently and these hooks quietly stop sharing a cache with
 * the `api.topics.*` and `api.project.*` call sites that have not moved.
 *
 * EVERY PAYLOAD IS THE PRODUCER'S OWN TYPE. `TopicClusteringStatus` and
 * `TopicClusteringRunHistoryEntry` are declared in `@langwatch/topic-contract`
 * and the service is annotated with them, so widening what a run reports is a
 * compile error at the producer rather than a blank column here.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
} from "@langwatch/topic-contract";

/** The project every clustering procedure is scoped to. */
type ProjectScope = { projectId: string };

export type TopicApiMap = {
  topics: {
    /** Whether a run is in flight, and what the last one did. */
    getClusteringStatus: {
      query: { input: ProjectScope; output: TopicClusteringStatus };
    };

    /** The recent runs, newest first, for the settings page's log. */
    getClusteringRunHistory: {
      query: { input: ProjectScope; output: TopicClusteringRunHistoryEntry[] };
    };
  };

  project: {
    /**
     * Asks for a run now.
     *
     * `started: false` is not a failure — it means a run was already underway,
     * which the card reports as information rather than as an error.
     */
    triggerTopicClustering: {
      mutation: { input: ProjectScope; output: { started: boolean } };
    };
  };
};

/**
 * The topic family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createFeatureApi`
 * for why separate instances still share cache entries.
 */
export const topicApi = createFeatureApi<TopicApiMap>();
