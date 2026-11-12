/**
 * The langyConversationPullRequests fold: which answers link a pull request to their
 * conversation, and which user messages count a CI follow-up or start the count again.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { LangyMessagePart } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyConversationPullRequestsRepository } from "../../repositories/memory/memory.langy-conversation-pull-requests.repository.ts";
import type { LangyConversationPullRequestsData } from "../../rules/langy-ci-follow-up.rules.ts";
import { LangyConversationPullRequestsFoldProjection } from "../langy-conversation-pull-requests.projection.ts";
import { agentRespondedEvent, messageRecordedEvent, T0 } from "./langyEventFixtures.ts";

const projection = LangyConversationPullRequestsFoldProjection.create({
  store: MemoryLangyConversationPullRequestsRepository.create(LangyMemoryStore.create()),
});

function shell(command: string, state: string, output: string): LangyMessagePart {
  return { type: "tool-bash", toolCallId: `call-${command}`, input: { command }, state, output };
}

function answered(turnId: string, parts: LangyMessagePart[], occurredAt = T0) {
  const event = agentRespondedEvent({ id: `evt_${turnId}`, occurredAt, turnId });
  return { ...event, data: { ...event.data, parts } };
}

function personSpoke(id: string) {
  return messageRecordedEvent({ id, occurredAt: T0 + 10, messageId: id });
}

function ciFollowUpRecorded(id: string) {
  const event = messageRecordedEvent({ id, occurredAt: T0 + 10, messageId: id });
  return {
    ...event,
    data: {
      ...event.data,
      ciFollowUp: { repositoryFullName: "acme/agent", prNumber: 12, headSha: "abc123" },
    },
  };
}

const OPENED = shell(
  "git push -u origin HEAD && gh pr create --title t --body b",
  "output-available",
  "https://github.com/Acme/Agent/pull/12\n",
);

function fold(events: { type: string }[]): LangyConversationPullRequestsData {
  return events.reduce((state, event) => projection.apply(state, event), projection.init());
}

describe("the langyConversationPullRequests fold", () => {
  describe("given a turn whose gh pr create printed a pull request URL", () => {
    /** @scenario "A pull request Langy opened in a turn is linked to its conversation" */
    it("keeps the pull request, repository lowercased, and when it was linked", () => {
      const state = fold([answered("turn-1", [OPENED])]);

      expect(state.PullRequests).toEqual([
        { repositoryFullName: "acme/agent", prNumber: 12, linkedAt: T0 },
      ]);
    });

    it("keeps one entry when a later answer prints the same pull request again", () => {
      const state = fold([answered("turn-1", [OPENED]), answered("turn-2", [OPENED], T0 + 5)]);

      expect(state.PullRequests).toEqual([
        { repositoryFullName: "acme/agent", prNumber: 12, linkedAt: T0 },
      ]);
    });
  });

  describe("given a turn whose gh pr create failed", () => {
    /** @scenario "A failed pull request command links nothing" */
    it("links nothing", () => {
      const state = fold([
        answered("turn-1", [
          shell("gh pr create --title t", "output-error", "https://github.com/acme/agent/pull/12"),
        ]),
      ]);

      expect(state.PullRequests).toEqual([]);
    });
  });

  describe("given a turn that only echoed a pull request URL", () => {
    /** @scenario "A URL printed by a command that opens no pull request links nothing" */
    it("links nothing", () => {
      const state = fold([
        answered("turn-1", [
          shell(
            "echo https://github.com/acme/agent/pull/12",
            "output-available",
            "https://github.com/acme/agent/pull/12",
          ),
        ]),
      ]);

      expect(state.PullRequests).toEqual([]);
    });
  });

  describe("given a conversation that opened a pull request", () => {
    /** @scenario "A follow-up message CI started counts one more in a row" */
    it("counts each follow-up message CI started", () => {
      const state = fold([
        answered("turn-1", [OPENED]),
        ciFollowUpRecorded("msg-ci-1"),
        ciFollowUpRecorded("msg-ci-2"),
      ]);

      expect(state.FollowUpsInARow).toBe(2);
    });

    /** @scenario "A message the person sends resets the count" */
    it("starts the count again when the person sends a message", () => {
      const state = fold([
        answered("turn-1", [OPENED]),
        ciFollowUpRecorded("msg-ci-1"),
        personSpoke("msg-person"),
      ]);

      expect(state.FollowUpsInARow).toBe(0);
    });

    /** @scenario "A follow-up turn completing does not reset the count" */
    it("keeps the count when the follow-up turn itself completes", () => {
      const state = fold([
        answered("turn-1", [OPENED]),
        ciFollowUpRecorded("msg-ci-1"),
        answered("turn-2", [], T0 + 20),
      ]);

      expect(state.FollowUpsInARow).toBe(1);
      expect(state.PullRequests).toHaveLength(1);
    });
  });
});
