/**
 * A redelivered answer counts its pull requests again into the same day's set, so the daily cap
 * still holds each pull request once.
 * @see specs/langy/langy-github-prs.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import type { LangyMessagePart } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LangyGithubPrQuotaService } from "../../features/github/services/langy-github-pr-quota.service.ts";
import { LangyGithubPrCountMemoryRepository } from "../../repositories/memory/memory.langy-github-pr-count.repository.ts";
import { createLangyGithubPrCountSubscriber } from "../langy-github-pr-count.subscriber.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

const OPENED: LangyMessagePart = {
  type: "tool-bash",
  toolCallId: "call-1",
  input: { command: "git push -u origin HEAD && gh pr create --title t --body b" },
  state: "output-available",
  output: "https://github.com/acme/agent/pull/12\n",
};

describe("createLangyGithubPrCountSubscriber redelivery", () => {
  /** @scenario "Pushing to a pull request already opened does not count again" */
  it("counts the pull request of a twice-delivered answer once", async () => {
    const quota = LangyGithubPrQuotaService.create({
      counts: LangyGithubPrCountMemoryRepository.create(),
    });
    const subscriber = createLangyGithubPrCountSubscriber({
      conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
      counter: quota,
    });
    const event = agentRespondedEvent({
      id: "evt_answer",
      occurredAt: nowInstant().epochMilliseconds,
      turnId: "turn-1",
    });
    const answer = { ...event, data: { ...event.data, parts: [OPENED] } };

    await subscriber.handle(answer, context);
    await subscriber.handle(answer, context);

    expect((await quota.usage({ userId: "user-1", limit: 20 })).remaining).toBe(19);
  });
});
