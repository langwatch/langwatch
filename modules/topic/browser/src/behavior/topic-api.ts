/**
 * The procedures this package calls, and the hooks that call them.
 * Segment names are the React Query cache key (ADR-004) — this is the
 * package's one `@langwatch/api/web` import.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { topicTrpc } from "@langwatch/topic-contract";

/** Procedures another feature owns. */
type BorrowedProcedures = {
  project: {
    /** Asks for a run now. `started: false` means one was already underway. */
    triggerTopicClustering: {
      mutation: { input: { projectId: string }; output: { started: boolean } };
    };
  };
};

export type TopicApiMap = ContractApiMap<typeof topicTrpc> & BorrowedProcedures;

/**
 * The topic family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createModuleApi`
 * for why separate instances still share cache entries.
 */
export const topicApi = createModuleApi<TopicApiMap>();
