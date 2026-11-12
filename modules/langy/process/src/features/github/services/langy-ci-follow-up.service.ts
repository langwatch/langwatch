/**
 * Starts Langy again in the conversation that opened a pull request, once CI on it finished.
 * Once per commit comes from the turn's durable admission: the commit is its idempotency key.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GithubPullRequestChecksCompletedEventData } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { LangyConversationStateData } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  LangyConversationPullRequestMatch,
  LangyConversationPullRequestsRepository,
} from "../../../repositories/langy-conversation-pull-requests.repository.ts";
import {
  LANGY_CI_FOLLOW_UPS_IN_A_ROW,
  ciFollowUpMessage,
  pullRequestKeyOf,
} from "../../../rules/langy-ci-follow-up.rules.ts";
import { LangyAccessService } from "../../../services/langy-access.service.ts";
import type { LangyActorUserReader } from "../../../services/langy-actor-session.service.ts";
import type { StartConversationTurnInput } from "../../turn/services/langy-turn-shared.service.ts";
import type { LangyTurnsBoundsService } from "../../turn/services/langy-turns-bounds.service.ts";

const logger = createLogger("langwatch:langy:ci-follow-up");

/** A conversation already answering is asked again later, not skipped. */
const RETRY_LATER_CODES = new Set(["langy_turn_in_progress", "langy_agent_unavailable"]);

/** The commit's key was already admitted with another message: this commit already woke Langy. */
const ALREADY_WOKEN_CODE = "langy_idempotency_mismatch";

type CiFollowUpTurnStart = StartConversationTurnInput & {
  ciFollowUp: NonNullable<StartConversationTurnInput["ciFollowUp"]>;
};

type LangyCiFollowUpMembers = Readonly<{
  pullRequests: Pick<LangyConversationPullRequestsRepository, "findByPullRequest">;
  conversations: Pick<StateProjectionStore<LangyConversationStateData>, "get">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  users: LangyActorUserReader;
  featureFlags: FeatureFlagApi;
  bounds: Pick<LangyTurnsBoundsService, "assertUnattendedTurnWithinBounds">;
  turns: {
    startCiFollowUpTurn(input: CiFollowUpTurnStart): Promise<{
      conversationId: string;
      turnId: string;
    }>;
  };
}>;

export class LangyCiFollowUpService {
  static create(members: LangyCiFollowUpMembers): LangyCiFollowUpService {
    return new LangyCiFollowUpService(members);
  }

  private constructor(private readonly members: LangyCiFollowUpMembers) {}

  /** Throws only to be delivered again: when the conversation is busy with another turn. */
  async handleChecksCompleted(checks: GithubPullRequestChecksCompletedEventData): Promise<void> {
    const projectIds = await this.members.projects.listIdsByOrganization({
      organizationId: checks.organizationId,
    });
    for (const prNumber of checks.pullRequestNumbers) {
      const opened = await this.members.pullRequests.findByPullRequest({
        projectIds,
        repositoryFullName: checks.repositoryFullName,
        prNumber,
      });
      for (const conversation of opened) {
        await this.followUp({ checks, prNumber, conversation });
      }
    }
  }

  private async followUp({
    checks,
    prNumber,
    conversation,
  }: {
    checks: GithubPullRequestChecksCompletedEventData;
    prNumber: number;
    conversation: LangyConversationPullRequestMatch;
  }): Promise<void> {
    const key = { repositoryFullName: checks.repositoryFullName, prNumber };
    const inARow = conversation.followUpsInARow;
    if (inARow >= LANGY_CI_FOLLOW_UPS_IN_A_ROW) {
      logger.info({ ...key, inARow }, "CI follow-up cap reached; waiting for the person");
      return;
    }

    const session = await this.sessionOf({ conversation, organizationId: checks.organizationId });
    if (!session) return;

    try {
      await this.members.turns.startCiFollowUpTurn({
        projectId: conversation.projectId,
        idempotencyKey: `ci-follow-up:${pullRequestKeyOf(key)}@${checks.headSha}`,
        session,
        requestedConversationId: conversation.conversationId,
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: ciFollowUpMessage({
                  ...key,
                  headBranch: checks.headBranch,
                  headSha: checks.headSha,
                  conclusion: checks.conclusion,
                  failedChecks: checks.failedChecks,
                  followUpNumber: inARow + 1,
                }),
              },
            ],
          },
        ],
        isRetry: false,
        turnContext: {},
        ciFollowUp: {
          ...key,
          headSha: checks.headSha,
          countTurn: () =>
            this.members.bounds.assertUnattendedTurnWithinBounds({
              projectId: conversation.projectId,
            }),
        },
      });
    } catch (error) {
      if (!HandledError.isHandled(error)) throw error;
      if (RETRY_LATER_CODES.has(error.code)) throw error;
      if (error.code === ALREADY_WOKEN_CODE) {
        logger.info({ ...key, headSha: checks.headSha }, "CI follow-up already started");
        return;
      }
      logger.warn(
        { error, ...key, conversationId: conversation.conversationId },
        "CI follow-up refused",
      );
    }
  }

  /** The conversation's owner as they are now, or none when they may no longer act. */
  private async sessionOf({
    conversation,
    organizationId,
  }: {
    conversation: LangyConversationPullRequestMatch;
    organizationId: string;
  }) {
    const read = await this.members.conversations.get(conversation.conversationId, {
      tenantId: createTenantId(conversation.projectId),
      aggregateId: conversation.conversationId,
    });
    if (read.kind === "empty" || !read.projection.state.UserId) return null;
    const user = await this.members.users.findById({ id: read.projection.state.UserId });
    if (!user || user.deactivatedAt !== null) return null;
    const session = { user: { id: user.id, name: user.name, email: user.email } };
    const hasAccess = await LangyAccessService.create({
      featureFlags: this.members.featureFlags,
    }).hasAccess({ user: session.user, projectId: conversation.projectId, organizationId });
    return hasAccess ? session : null;
  }
}
