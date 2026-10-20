import { SessionStateStoreFactory } from "@langwatch/redis-client";
/**
 * The confirmation gate against a real Redis, through the real REST runtime: the card a refused
 * delete raises, and the single-use, all-or-none spending of the clicks.
 * @vitest-environment node
 * @see specs/langy/langy-delete-confirmation.feature
 */
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { testRedisUrl } from "../../../../__tests__/support/test-redis-url.ts";
import { LangyDeleteConfirmationRedisRepository } from "../../../../repositories/redis/redis.langy-delete-confirmation.repository.ts";
import { deleteConfirmationFixture } from "./delete-confirmation.fixture.ts";

let redis: Redis;
let container: StartedRedisContainer | null = null;
let langy: ReturnType<typeof deleteConfirmationFixture>;
let run = 0;

beforeAll(async () => {
  const configured = testRedisUrl();
  if (configured) {
    redis = new Redis(configured);
  } else {
    container = await new RedisContainer("redis:alpine").start();
    redis = new Redis(container.getConnectionUrl());
  }
}, 60_000);

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
});

beforeEach(async () => {
  run += 1;
  // A project of its own per test, so keys a shared Redis already holds never meet this one's.
  const projectId = `proj_confirm_${Date.now()}_${run}`;
  langy = deleteConfirmationFixture({
    store: SessionStateStoreFactory.redis(redis),
    confirmations: LangyDeleteConfirmationRedisRepository.create({ redis }),
    projectId,
    now: () => Date.now(),
  });
  await langy.bindKey("turn1", "turn_1");
});

describe("the confirmation gate over Redis", () => {
  describe("when Langy deletes the evaluator with no click", () => {
    /** @scenario "A delete with no click is refused and a card is shown" */
    it("refuses with the words Langy acts on and shows the server's own card", async () => {
      const answer = await langy.deleteEvaluator("ev_toxicity");

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(answer.body.message).toBe(
        'Deleting needs a confirmation click. A confirmation card for evaluator "Toxicity check" ' +
          "is now shown to the user. Wait for their answer; after they choose Yes, run the same " +
          "command again.",
      );
      expect(langy.started).toEqual([
        expect.objectContaining({
          turnId: "turn_1",
          questions: [
            expect.objectContaining({
              question: 'Delete evaluator "Toxicity check"?',
              options: [{ label: "Yes, delete" }, { label: "No, keep it" }],
              multiple: false,
              allowOther: false,
            }),
          ],
        }),
      ]);
      expect(langy.started[0]?.toolCallId).toBeUndefined();
      expect(langy.archived).toEqual([]);
    });
  });

  describe("given the person clicked Yes on the card for the evaluator", () => {
    beforeEach(async () => {
      await langy.deleteEvaluator("ev_toxicity");
      await langy.click({ id: "ev_toxicity", choice: "yes" });
    });

    /** @scenario "A click on Yes lets the same delete run once" */
    it("runs the delete", async () => {
      const answer = await langy.deleteEvaluator("ev_toxicity");

      expect(answer).toMatchObject({ status: 200, body: { archived: "ev_toxicity" } });
      expect(langy.archived).toEqual(["ev_toxicity"]);
    });

    /** @scenario "One click covers one request" */
    it("runs the first of two deletes and refuses the second", async () => {
      const first = await langy.deleteEvaluator("ev_toxicity");
      const second = await langy.deleteEvaluator("ev_toxicity");

      expect([first.status, second.status]).toEqual([200, 409]);
      expect(second.body.code).toBe("langy_confirmation_required");
      expect(langy.archived).toEqual(["ev_toxicity"]);
    });
  });

  describe("given the person clicked Yes on the card for a different evaluator", () => {
    /** @scenario "A click on another item does not cover this one" */
    it("refuses the delete", async () => {
      await langy.deleteEvaluator("ev_faithful");
      await langy.click({ id: "ev_faithful", choice: "yes" });

      const answer = await langy.deleteEvaluator("ev_toxicity");

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(langy.archived).toEqual([]);
    });
  });

  describe("given the person clicked No on the card for the evaluator", () => {
    /** @scenario "A click on No never lets the delete run" */
    it("refuses the delete", async () => {
      await langy.deleteEvaluator("ev_toxicity");
      await langy.click({ id: "ev_toxicity", choice: "no" });

      const answer = await langy.deleteEvaluator("ev_toxicity");

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(langy.archived).toEqual([]);
    });
  });

  describe("given the person clicked Yes for one of two records", () => {
    /** @scenario "A bulk delete needs a click for every item" */
    it("refuses the bulk delete and spends nothing", async () => {
      await langy.deleteEvaluator("ev_toxicity");
      await langy.click({ id: "ev_toxicity", choice: "yes" });

      const bulk = await langy.deleteMany(["ev_toxicity", "ev_faithful"]);
      const single = await langy.deleteEvaluator("ev_toxicity");

      expect(bulk).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(bulk.body.message).toContain('evaluator "Faithfulness"');
      expect(bulk.body.message).not.toContain('evaluator "Toxicity check"');
      expect(single.status).toBe(200);
      expect(langy.archived).toEqual(["ev_toxicity"]);
    });
  });
});
