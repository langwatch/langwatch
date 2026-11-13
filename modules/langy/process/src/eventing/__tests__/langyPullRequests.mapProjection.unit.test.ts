/**
 * The langyPullRequests map: which answers store a pull request, one row each, and a redelivered
 * answer storing nothing new.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { initLangyConversationState, type LangyMessagePart } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyConversationProjectionRepository } from "../../repositories/memory/memory.langy-conversation-projection.repository.ts";
import { MemoryLangyPullRequestRepository } from "../../repositories/memory/memory.langy-pull-request.repository.ts";
import { LangyPullRequestsMapProjection } from "../langy-pull-requests.projection.ts";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
  USER_ID,
} from "./langyEventFixtures.ts";

const context = { tenantId: createTenantId(PROJECT_ID), aggregateId: CONVERSATION_ID };

function shell(command: string, state: string, output: string): LangyMessagePart {
  return { type: "tool-bash", toolCallId: `call-${command}`, input: { command }, state, output };
}

function answered(turnId: string, parts: LangyMessagePart[], occurredAt = T0) {
  const event = agentRespondedEvent({ id: `evt_${turnId}`, occurredAt, turnId });
  return { ...event, data: { ...event.data, parts } };
}

const OPENED = shell(
  "git push -u origin HEAD && gh pr create --title t --body b",
  "output-available",
  "https://github.com/Acme/Agent/pull/12\n",
);

async function harness({ folded = true }: { folded?: boolean } = {}) {
  const store = LangyMemoryStore.create();
  const pullRequests = MemoryLangyPullRequestRepository.create(store);
  if (folded) {
    await MemoryLangyConversationProjectionRepository.create(store).store(
      {
        state: {
          ...initLangyConversationState(),
          ConversationId: CONVERSATION_ID,
          UserId: USER_ID,
          CreatedAt: T0,
          UpdatedAt: T0,
          LastEventOccurredAt: T0,
        },
        cursor: { acceptedAt: T0, eventId: "evt-started" },
        occurredAt: T0,
        createdAt: T0,
        updatedAt: T0,
        version: "test",
      },
      context,
    );
  }
  const projection = LangyPullRequestsMapProjection.create({ store: pullRequests });
  const deliver = async (event: ReturnType<typeof answered>) => {
    if (projection.options.enqueue?.filter?.(event) === false) return;
    const record = projection.map(event);
    if (record) await projection.store.append(record, context);
  };
  const lookUp = (prNumber = 12) =>
    pullRequests.findByPullRequest({
      projectIds: [PROJECT_ID],
      repositoryFullName: "acme/agent",
      prNumber,
    });
  return { projection, deliver, lookUp };
}

describe("the langyPullRequests map", () => {
  describe("given a turn whose gh pr create printed a pull request URL", () => {
    /** @scenario "A pull request Langy opened in a turn is linked to its conversation" */
    it("stores the pull request with its conversation, owner and when it opened", async () => {
      const { deliver, lookUp } = await harness();

      await deliver(answered("turn-1", [OPENED]));

      expect(await lookUp()).toEqual([
        { projectId: PROJECT_ID, conversationId: CONVERSATION_ID, userId: USER_ID, openedAt: T0 },
      ]);
    });

    /** @scenario "A redelivered answer stores its pull request once" */
    it("keeps the first row when the answer is delivered again", async () => {
      const { deliver, lookUp } = await harness();

      await deliver(answered("turn-1", [OPENED]));
      await deliver(answered("turn-1", [OPENED], T0 + 5));

      expect(await lookUp()).toEqual([expect.objectContaining({ openedAt: T0 })]);
    });

    it("retries while the conversation is not folded yet", async () => {
      const { deliver } = await harness({ folded: false });

      const failure = await deliver(answered("turn-1", [OPENED])).catch((error) => error);

      expect(failure).toMatchObject({ retryable: true });
    });
  });

  describe("given a turn whose gh pr create failed", () => {
    /** @scenario "A failed pull request command links nothing" */
    it("maps nothing and is never queued", async () => {
      const { projection, deliver, lookUp } = await harness();
      const answer = answered("turn-1", [
        shell("gh pr create --title t", "output-error", "https://github.com/acme/agent/pull/12"),
      ]);

      await deliver(answer);

      expect(projection.map(answer)).toBeNull();
      expect(projection.options.enqueue?.filter?.(answer)).toBe(false);
      expect(await lookUp()).toEqual([]);
    });
  });

  describe("given a turn that only echoed a pull request URL", () => {
    /** @scenario "A URL printed by a command that opens no pull request links nothing" */
    it("maps nothing", async () => {
      const { projection } = await harness();

      expect(
        projection.map(
          answered("turn-1", [
            shell(
              "echo https://github.com/acme/agent/pull/12",
              "output-available",
              "https://github.com/acme/agent/pull/12",
            ),
          ]),
        ),
      ).toBeNull();
    });
  });
});
