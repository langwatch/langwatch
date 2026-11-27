/**
 * The PR cap is the only thing standing between a runaway worker (bad skill, prompt-injected pull)
 * and a user's GitHub account getting flagged for abuse. It counts the pull requests Langy opened,
 * one row each in the read model, by the day they opened.
 * @vitest-environment node
 */
import { createTenantId } from "@langwatch/eventing";
import { initLangyConversationState } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyConversationProjectionRepository } from "../../../../repositories/memory/memory.langy-conversation-projection.repository.ts";
import { MemoryLangyPullRequestRepository } from "../../../../repositories/memory/memory.langy-pull-request.repository.ts";
import { LangyGithubPrQuotaService } from "../langy-github-pr-quota.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROJECT_ID = "project-1";

async function harness() {
  const store = LangyMemoryStore.create();
  const conversations = MemoryLangyConversationProjectionRepository.create(store);
  const pullRequests = MemoryLangyPullRequestRepository.create(store);
  const quota = LangyGithubPrQuotaService.create({ pullRequests });
  let answers = 0;

  /** One answer in a conversation of `userId` that opened these pull requests of "acme/a". */
  const opened = async ({
    userId,
    numbers,
    at,
    conversationId = `conv-${userId}`,
  }: {
    userId: string;
    numbers: number[];
    at: number;
    conversationId?: string;
  }) => {
    const context = { tenantId: createTenantId(PROJECT_ID), aggregateId: conversationId };
    await conversations.store(
      {
        state: {
          ...initLangyConversationState(),
          ConversationId: conversationId,
          UserId: userId,
          CreatedAt: at,
          UpdatedAt: at,
          LastEventOccurredAt: at,
        },
        cursor: { acceptedAt: at, eventId: `evt-${conversationId}` },
        occurredAt: at,
        createdAt: at,
        updatedAt: at,
        version: "test",
      },
      context,
    );
    answers += 1;
    await pullRequests.append(
      {
        ConversationId: conversationId,
        PullRequests: numbers.map((prNumber) => ({ repositoryFullName: "acme/a", prNumber })),
        OpenedAt: at,
        SourceEventId: `evt-answer-${answers}`,
      },
      context,
    );
  };

  return { quota, opened };
}

describe("LangyGithubPrQuotaService", () => {
  describe("given three pull requests opened today", () => {
    /** @scenario "The daily cap counts pull requests that opened, not turns" */
    it("leaves the rest of the day's cap", async () => {
      const { quota, opened } = await harness();
      const at = nowInstant().epochMilliseconds;

      await opened({ userId: "u1", numbers: [1, 2], at });
      await opened({ userId: "u1", numbers: [7], at, conversationId: "conv-u1-other" });

      expect(await quota.usage({ userId: "u1", limit: 20 })).toMatchObject({
        allowed: true,
        remaining: 17,
      });
    });
  });

  describe("when the answer that opened a pull request is stored twice", () => {
    /** @scenario "Pushing to a pull request already opened does not count again" */
    it("counts it once", async () => {
      const { quota, opened } = await harness();
      const at = nowInstant().epochMilliseconds;

      await opened({ userId: "u1", numbers: [1], at });
      await opened({ userId: "u1", numbers: [1], at });

      expect((await quota.usage({ userId: "u1", limit: 20 })).remaining).toBe(19);
    });
  });

  describe("given the per-day maximum already opened", () => {
    /** @scenario "The API process counts the daily pull-request cap from the pull requests Langy opened" */
    it("refuses the person until the day rolls over, and only that person", async () => {
      const { quota, opened } = await harness();
      const at = nowInstant().epochMilliseconds;

      await opened({ userId: "u1", numbers: Array.from({ length: 20 }, (_, n) => n + 1), at });

      const usage = await quota.usage({ userId: "u1", limit: 20 });
      expect(usage).toMatchObject({ allowed: false, remaining: 0 });
      expect(usage.resetAt).toBe((Math.floor(at / DAY_MS) + 1) * DAY_MS);
      expect((await quota.usage({ userId: "u2", limit: 20 })).allowed).toBe(true);
    });
  });

  describe("given pull requests opened yesterday", () => {
    it("does not count them against today", async () => {
      const { quota, opened } = await harness();
      const yesterday = nowInstant().epochMilliseconds - DAY_MS;

      await opened({
        userId: "u1",
        numbers: Array.from({ length: 20 }, (_, n) => n + 1),
        at: yesterday,
      });

      expect((await quota.usage({ userId: "u1", limit: 20 })).allowed).toBe(true);
    });
  });

  describe("when the read model cannot be read at all", () => {
    /** @scenario "A deployment with no counter never denies a pull request" */
    it("allows the pull request", async () => {
      const quota = LangyGithubPrQuotaService.create({
        pullRequests: {
          countOpenedSince: async () => {
            throw new Error("no database connection");
          },
        },
      });

      const usage = await quota.usage({ userId: "u1", limit: 20 });

      expect(usage).toMatchObject({ allowed: true, remaining: 20 });
    });
  });
});
