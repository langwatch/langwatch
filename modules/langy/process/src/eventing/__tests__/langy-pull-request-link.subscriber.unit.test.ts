/**
 * The langyPullRequestLink subscriber over the memory link store: which answers link a pull
 * request to their conversation, and which completed turns start the follow-up count again.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import type { LangyMessagePart } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import { LangyPullRequestLinkMemoryRepository } from "../../repositories/memory/memory.langy-pull-request-link.repository.ts";
import { createLangyPullRequestLinkSubscriber } from "../langy-pull-request-link.subscriber.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };
const PULL_REQUEST = { repositoryFullName: "acme/agent", prNumber: 12 };

function shell(command: string, state: string, output: string): LangyMessagePart {
  return { type: "tool-bash", toolCallId: `call-${command}`, input: { command }, state, output };
}

function answered(turnId: string, parts: LangyMessagePart[]) {
  const event = agentRespondedEvent({ id: `evt_${turnId}`, occurredAt: T0, turnId });
  return { ...event, data: { ...event.data, parts } };
}

function harness() {
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
  return { links, subscriber };
}

const OPENED = shell(
  "git push -u origin HEAD && gh pr create --title t --body b",
  "output-available",
  "https://github.com/acme/agent/pull/12\n",
);

describe("the langyPullRequestLink subscriber", () => {
  describe("given a turn whose gh pr create printed a pull request URL", () => {
    /** @scenario "A pull request Langy opened in a turn is linked to its conversation" */
    it("links the pull request to the conversation, project, organization and owner", async () => {
      const { links, subscriber } = harness();

      await subscriber.handle(answered("turn-1", [OPENED]), context);

      expect(await links.findLinks(PULL_REQUEST)).toEqual([
        {
          ...PULL_REQUEST,
          organizationId: "org-1",
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          userId: "user-1",
          linkedAt: T0,
        },
      ]);
    });
  });

  describe("given a turn whose gh pr create failed", () => {
    /** @scenario "A failed pull request command links nothing" */
    it("links nothing", async () => {
      const { links, subscriber } = harness();

      await subscriber.handle(
        answered("turn-1", [
          shell("gh pr create --title t", "output-error", "https://github.com/acme/agent/pull/12"),
        ]),
        context,
      );

      expect(await links.findLinks(PULL_REQUEST)).toEqual([]);
    });
  });

  describe("given a turn that only echoed a pull request URL", () => {
    /** @scenario "A URL printed by a command that opens no pull request links nothing" */
    it("links nothing", async () => {
      const { links, subscriber } = harness();

      await subscriber.handle(
        answered("turn-1", [
          shell(
            "echo https://github.com/acme/agent/pull/12",
            "output-available",
            "https://github.com/acme/agent/pull/12",
          ),
        ]),
        context,
      );

      expect(await links.findLinks(PULL_REQUEST)).toEqual([]);
    });
  });

  describe("given a pull request with automatic follow-ups in its conversation", () => {
    let given: ReturnType<typeof harness>;

    beforeEach(async () => {
      given = harness();
      await given.subscriber.handle(answered("turn-1", [OPENED]), context);
      await given.links.recordFollowUp({
        ...PULL_REQUEST,
        conversationId: CONVERSATION_ID,
        turnId: "turn-2",
      });
    });

    /** @scenario "A turn the person sends resets the count" */
    it("starts the count again when a turn the person sent completes", async () => {
      await given.subscriber.handle(answered("turn-3", []), context);

      expect(await given.links.countFollowUps(PULL_REQUEST)).toBe(0);
    });

    /** @scenario "A follow-up turn completing does not reset the count" */
    it("keeps the count when the follow-up turn itself completes", async () => {
      await given.subscriber.handle(answered("turn-2", []), context);

      expect(await given.links.countFollowUps(PULL_REQUEST)).toBe(1);
    });
  });
});
