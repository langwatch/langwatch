/**
 * Starts Langy again in the conversation that opened a pull request, once CI on it finished.
 * ORDER IS THE CONTRACT: every refusal comes before the commit's wake is claimed.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GithubPullRequestChecksCompletedEventData } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type {
  LangyPullRequestLink,
  LangyPullRequestLinkRepository,
} from "../../../repositories/langy-pull-request-link.repository.ts";
import {
  LANGY_CI_FOLLOW_UPS_IN_A_ROW,
  ciFollowUpMessage,
} from "../../../rules/langy-ci-follow-up.rules.ts";
import { LangyAccessService } from "../../../services/langy-access.service.ts";
import type { LangyActorUserReader } from "../../../services/langy-actor-session.service.ts";
import type { StartConversationTurnInput } from "../../turn/services/langy-turn-shared.service.ts";
import type { LangyTurnsBoundsService } from "../../turn/services/langy-turns-bounds.service.ts";

const logger = createLogger("langwatch:langy:ci-follow-up");

/** A conversation already answering is asked again later, not skipped. */
const RETRY_LATER_CODES = new Set(["langy_turn_in_progress", "langy_agent_unavailable"]);

type CiFollowUpTurnStart = StartConversationTurnInput & {
  ciFollowUp: NonNullable<StartConversationTurnInput["ciFollowUp"]>;
};

type LangyCiFollowUpMembers = Readonly<{
  links: Pick<
    LangyPullRequestLinkRepository,
    "findLinks" | "claimWake" | "releaseWake" | "countFollowUps" | "recordFollowUp"
  >;
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
    for (const prNumber of checks.pullRequestNumbers) {
      await this.followUp({ checks, prNumber });
    }
  }

  private async followUp({
    checks,
    prNumber,
  }: {
    checks: GithubPullRequestChecksCompletedEventData;
    prNumber: number;
  }): Promise<void> {
    const { links } = this.members;
    const key = { repositoryFullName: checks.repositoryFullName, prNumber };
    const link = (await links.findLinks(key)).find(
      (candidate) => candidate.organizationId === checks.organizationId,
    );
    if (!link) return;

    const inARow = await links.countFollowUps(key);
    if (inARow >= LANGY_CI_FOLLOW_UPS_IN_A_ROW) {
      logger.info({ ...key, inARow }, "CI follow-up cap reached; waiting for the person");
      return;
    }

    const session = await this.sessionOf(link);
    if (!session) return;

    const wake = { ...key, headSha: checks.headSha };
    if (!(await links.claimWake(wake))) return;

    try {
      const started = await this.members.turns.startCiFollowUpTurn({
        projectId: link.projectId,
        idempotencyKey: `ci-follow-up:${key.repositoryFullName.toLowerCase()}#${prNumber}@${checks.headSha}`,
        session,
        requestedConversationId: link.conversationId,
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
          repositoryFullName: checks.repositoryFullName,
          countTurn: () =>
            this.members.bounds.assertUnattendedTurnWithinBounds({ projectId: link.projectId }),
        },
      });
      await links.recordFollowUp({
        ...key,
        conversationId: started.conversationId,
        turnId: started.turnId,
      });
    } catch (error) {
      if (HandledError.isHandled(error) && RETRY_LATER_CODES.has(error.code)) {
        await links.releaseWake(wake);
        throw error;
      }
      logger.warn({ error, ...key, conversationId: link.conversationId }, "CI follow-up refused");
    }
  }

  /** The conversation's owner as they are now, or none when they may no longer act. */
  private async sessionOf(link: LangyPullRequestLink) {
    const user = await this.members.users.findById({ id: link.userId });
    if (!user || user.deactivatedAt !== null) return null;
    const session = { user: { id: user.id, name: user.name, email: user.email } };
    const hasAccess = await LangyAccessService.create({
      featureFlags: this.members.featureFlags,
    }).hasAccess({
      user: session.user,
      projectId: link.projectId,
      organizationId: link.organizationId,
    });
    return hasAccess ? session : null;
  }
}
