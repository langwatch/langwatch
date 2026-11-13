import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
  type MapProjectionOptions,
} from "@langwatch/eventing";

import {
  type LangyPullRequestsOpenedRecord,
  pullRequestsOpenedIn,
  pullRequestsOpenedRecordOf,
} from "../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyAgentRespondedEvent,
  LangyAgentRespondedEventSchema,
} from "./langy-conversation-state.projection.ts";

const pullRequestEvents = [LangyAgentRespondedEventSchema] as const;

/**
 * The pull requests Langy opened, one row each, from the answer whose `gh pr create` printed them.
 * The store keeps the first answer per pull request, so a redelivered answer writes nothing new.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
export class LangyPullRequestsMapProjection
  extends AbstractMapProjection<LangyPullRequestsOpenedRecord, typeof pullRequestEvents>
  implements MapEventHandlers<typeof pullRequestEvents, LangyPullRequestsOpenedRecord>
{
  readonly name = "langyPullRequests";
  readonly store: AppendStore<LangyPullRequestsOpenedRecord>;
  protected readonly events = pullRequestEvents;

  override options: MapProjectionOptions<LangyAgentRespondedEvent> = {
    groupKeyFn: (event) => `langy:${event.data.conversationId}:pull-requests`,
    enqueue: { filter: (event) => pullRequestsOpenedIn(event.data.parts).length > 0 },
  };

  static create(deps: {
    store: AppendStore<LangyPullRequestsOpenedRecord>;
  }): LangyPullRequestsMapProjection {
    return new LangyPullRequestsMapProjection(deps);
  }

  constructor(deps: { store: AppendStore<LangyPullRequestsOpenedRecord> }) {
    super();
    this.store = deps.store;
  }

  mapLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
  ): LangyPullRequestsOpenedRecord | null {
    const record = pullRequestsOpenedRecordOf(event);
    return record.PullRequests.length > 0 ? record : null;
  }
}
