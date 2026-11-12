/**
 * A redelivered answer links the same pull request again under the same conversation, so the
 * store keeps one link and its follow-up count is untouched by the second delivery.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import type { LangyMessagePart } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangyPullRequestLinkMemoryRepository } from "../../repositories/memory/memory.langy-pull-request-link.repository.ts";
import { createLangyPullRequestLinkSubscriber } from "../langy-pull-request-link.subscriber.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };
const PULL_REQUEST = { repositoryFullName: "acme/agent", prNumber: 12 };

describe("createLangyPullRequestLinkSubscriber redelivery", () => {
  it("keeps one link and the follow-up count when the same answer arrives twice", async () => {
    const links = LangyPullRequestLinkMemoryRepository.create();
    const subscriber = createLangyPullRequestLinkSubscriber({
      links,
      conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
      projects: createApiFixture<ProjectApi>({
        findIdentity: async () => ({
          id: PROJECT_ID,
          name: "Project",
          slug: "project",
          teamId: "team-1",
          organizationId: "org-1",
          isPersonal: false,
          ownerUserId: null,
          kind: "project",
        }),
      }),
    });
    const event = agentRespondedEvent({ id: "evt_follow_up", occurredAt: T0, turnId: "turn-2" });
    const parts: LangyMessagePart[] = [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        input: { command: "gh pr create --title t --body b" },
        state: "output-available",
        output: "https://github.com/acme/agent/pull/12",
      },
    ];
    const answer = { ...event, data: { ...event.data, parts } };
    await links.recordFollowUp({
      ...PULL_REQUEST,
      conversationId: CONVERSATION_ID,
      turnId: "turn-2",
    });

    await subscriber.handle(answer, context);
    await subscriber.handle(answer, context);

    expect(await links.findLinks(PULL_REQUEST)).toHaveLength(1);
    expect(await links.countFollowUps(PULL_REQUEST)).toBe(1);
  });
});
