/**
 * The daily pull request cap counts the pull requests a turn opened, from the answer that says
 * so, against the conversation's owner; a turn that opened none spends nothing.
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

function shell(command: string, state: string, output: string): LangyMessagePart {
  return { type: "tool-bash", toolCallId: `call-${command}`, input: { command }, state, output };
}

const OPENED = shell(
  "git push -u origin HEAD && gh pr create --title t --body b",
  "output-available",
  "https://github.com/acme/agent/pull/12\n",
);
const PUSHED = shell("git commit -am fix && git push", "output-available", "main -> main\n");
const FAILED_COMMAND = shell("git commit -m 'fix(retriever)'", "output-error", "not found");

let turns = 0;
function answered(parts: LangyMessagePart[]) {
  turns += 1;
  const event = agentRespondedEvent({
    id: `evt_${turns}`,
    occurredAt: nowInstant().epochMilliseconds,
    turnId: `turn-${turns}`,
  });
  return { ...event, data: { ...event.data, parts } };
}

function harness() {
  const quota = LangyGithubPrQuotaService.create({
    counts: LangyGithubPrCountMemoryRepository.create(),
  });
  const subscriber = createLangyGithubPrCountSubscriber({
    conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
    counter: quota,
  });
  const deliver = async (event: ReturnType<typeof answered>) => {
    if (subscriber.options?.enqueue?.filter?.(event) === false) return;
    await subscriber.handle(event, context);
  };
  return { quota, deliver };
}

describe("the langyGithubPrCount subscriber", () => {
  describe("given 25 code turns that opened no pull request", () => {
    /** @scenario "A code turn that opens no pull request spends nothing of the daily cap" */
    it("leaves the whole day's cap", async () => {
      const { quota, deliver } = harness();

      for (let n = 0; n < 25; n += 1) await deliver(answered([PUSHED, FAILED_COMMAND]));

      expect(await quota.usage({ userId: "user-1", limit: 20 })).toMatchObject({
        allowed: true,
        remaining: 20,
      });
    });
  });

  describe("given turns that opened a pull request, then pushed to it again", () => {
    /** @scenario "Pushing to a pull request already opened does not count again" */
    it("counts the pull request once against the conversation's owner", async () => {
      const { quota, deliver } = harness();

      await deliver(answered([OPENED]));
      await deliver(answered([PUSHED]));
      await deliver(answered([OPENED]));

      expect((await quota.usage({ userId: "user-1", limit: 20 })).remaining).toBe(19);
      expect((await quota.usage({ userId: "user-2", limit: 20 })).remaining).toBe(20);
    });
  });
});
