import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";

import {
  type LangyConversationPullRequestsData,
  withPullRequestsOpened,
  withUserMessage,
} from "../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyAgentRespondedEvent,
  LangyAgentRespondedEventSchema,
  type LangyMessageRecordedEvent,
  LangyMessageRecordedEventSchema,
} from "./langy-conversation-state.projection.ts";

const langyConversationPullRequestsEvents = [
  LangyAgentRespondedEventSchema,
  LangyMessageRecordedEventSchema,
] as const;

/** Bumped when the fold changes what it keeps; a new version is rebuilt from the log. */
const LANGY_CONVERSATION_PULL_REQUESTS_PROJECTION_VERSION = "2026-11-13";

/**
 * Per-conversation fold of the pull requests its turns opened and the CI follow-ups in a row
 * since the person last spoke, so finished checks find the conversation to wake.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
export class LangyConversationPullRequestsFoldProjection
  extends AbstractFoldProjection<
    LangyConversationPullRequestsData,
    typeof langyConversationPullRequestsEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<LangyConversationPullRequestsData>
  >
  implements
    FoldEventHandlers<
      typeof langyConversationPullRequestsEvents,
      LangyConversationPullRequestsData
    >
{
  readonly name = "langyConversationPullRequests";
  readonly version = LANGY_CONVERSATION_PULL_REQUESTS_PROJECTION_VERSION;
  readonly store: StateProjectionStore<LangyConversationPullRequestsData>;

  protected readonly events = langyConversationPullRequestsEvents;

  static create(deps: {
    store: StateProjectionStore<LangyConversationPullRequestsData>;
  }): LangyConversationPullRequestsFoldProjection {
    return new LangyConversationPullRequestsFoldProjection(deps);
  }

  constructor(deps: { store: StateProjectionStore<LangyConversationPullRequestsData> }) {
    super();
    this.store = deps.store;
  }

  protected initState(): Pick<
    LangyConversationPullRequestsData,
    "PullRequests" | "FollowUpsInARow"
  > {
    return { PullRequests: [], FollowUpsInARow: 0 };
  }

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
    state: LangyConversationPullRequestsData,
  ): LangyConversationPullRequestsData {
    return withPullRequestsOpened(state, { parts: event.data.parts, at: event.occurredAt });
  }

  handleLangyConversationMessageRecorded(
    event: LangyMessageRecordedEvent,
    state: LangyConversationPullRequestsData,
  ): LangyConversationPullRequestsData {
    if (event.data.role !== "user") return state;
    return withUserMessage(state, { isCiFollowUp: event.data.ciFollowUp !== undefined });
  }
}
