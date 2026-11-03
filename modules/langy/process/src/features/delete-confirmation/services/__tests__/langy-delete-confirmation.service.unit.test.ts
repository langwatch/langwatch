/**
 * The confirmation gate over memory twins, through the real REST runtime: what counts as a click,
 * which click covers which request, and how a card outlives the turn that raised it.
 * @vitest-environment node
 * @see specs/langy/langy-delete-confirmation.feature
 */
import { QUESTION_WAIT_BUDGET_MS } from "@langwatch/langy-contract";
import { memorySessionState } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import { LangyDeleteConfirmationMemoryRepository } from "../../../../repositories/memory/memory.langy-delete-confirmation.repository.ts";
import { deleteConfirmationFixture } from "./delete-confirmation.fixture.ts";

let now: number;
let langy: ReturnType<typeof deleteConfirmationFixture>;
let confirmations: LangyDeleteConfirmationMemoryRepository;

beforeEach(async () => {
  now = 1_760_000_000_000;
  const clock = () => now;
  confirmations = LangyDeleteConfirmationMemoryRepository.create({ now: clock });
  langy = deleteConfirmationFixture({
    store: memorySessionState({ now: clock }),
    confirmations,
    projectId: "proj_unit",
    now: clock,
  });
  await langy.bindKey("turn1", "turn_1");
});

describe("the confirmation gate", () => {
  describe("given a card is waiting for the evaluator", () => {
    beforeEach(async () => {
      await langy.deleteEvaluator("ev_toxicity");
    });

    describe("when the person types yes as a message", () => {
      /** @scenario "A typed yes is not a click" */
      it("still refuses the delete, while the same words with the card's click let it run", async () => {
        await langy.sendMessage({ text: "yes" });
        await langy.sendMessage({ text: "Chose: Yes, delete" });

        const typed = await langy.deleteEvaluator("ev_toxicity");

        expect(typed).toMatchObject({
          status: 409,
          body: { code: "langy_confirmation_required" },
        });
        expect(langy.archived).toEqual([]);

        const { waitId } = await langy.cardFor("ev_toxicity");
        await langy.sendMessage({
          text: "Chose: Yes, delete",
          selection: { waitId, optionId: "opt-1" },
        });

        const clicked = await langy.deleteEvaluator("ev_toxicity");

        expect(clicked.status).toBe(200);
        expect(langy.archived).toEqual(["ev_toxicity"]);
      });
    });

    describe("when Langy asks again, in this turn or the next", () => {
      /** @scenario "A waiting card is not shown twice" */
      it("refuses without raising a second card", async () => {
        const again = await langy.deleteEvaluator("ev_toxicity");
        langy.turn.current = null;
        await langy.waits.cancelTurn({ conversationId: langy.conversationId, turnId: "turn_1" });
        await langy.bindKey("turn2", "turn_2");
        langy.turn.current = "turn_2";
        const nextTurn = await langy.deleteEvaluator("ev_toxicity", "turn2");

        expect([again.status, nextTurn.status]).toEqual([409, 409]);
        expect(langy.started).toHaveLength(1);
      });
    });
  });

  describe("given the person clicked Yes on the card to delete the evaluator", () => {
    beforeEach(async () => {
      await langy.deleteEvaluator("ev_toxicity");
      await langy.click({ id: "ev_toxicity", choice: "yes" });
    });

    describe("when Langy disables the evaluator", () => {
      /** @scenario "A click for a delete does not cover a disable" */
      it("refuses, and the delete click stays unspent", async () => {
        const disabling = await langy.disableEvaluator("ev_toxicity");
        const deleting = await langy.deleteEvaluator("ev_toxicity");

        expect(disabling).toMatchObject({
          status: 409,
          body: { code: "langy_confirmation_required" },
        });
        expect(langy.disabled).toEqual([]);
        expect(deleting.status).toBe(200);
      });
    });
  });

  describe("given a Langy key with no conversation bound to it", () => {
    /** @scenario "A key that belongs to no conversation is refused" */
    it("refuses the delete and raises no card", async () => {
      const answer = await langy.deleteEvaluator("ev_toxicity", "unbound");

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(langy.started).toEqual([]);
      expect(langy.archived).toEqual([]);
    });
  });

  describe("given a key bound to no turn and a conversation with no turn running", () => {
    beforeEach(async () => {
      await langy.bindKey("turn2");
      langy.turn.current = null;
    });

    describe("when Langy deletes the evaluator", () => {
      it("refuses without claiming a card is shown, and raises none", async () => {
        const answer = await langy.deleteEvaluator("ev_toxicity", "turn2");

        expect(answer).toMatchObject({
          status: 409,
          body: { code: "langy_confirmation_required" },
        });
        expect(answer.body.message).toContain("no confirmation card could be shown");
        expect(answer.body.message).not.toContain("is now shown");
        expect(langy.started).toEqual([]);
      });
    });

    describe("when another request is raising the card for the same evaluator", () => {
      it("does not say a card is shown before one is", async () => {
        await confirmations.claimCardRaise({
          target: {
            projectId: "proj_unit",
            conversationId: langy.conversationId,
            resource: "evaluator",
            action: "delete",
            id: "ev_toxicity",
          },
          token: "other-request",
          ttlSeconds: 30,
        });

        const answer = await langy.deleteEvaluator("ev_toxicity", "turn2");

        expect(answer.status).toBe(409);
        expect(answer.body.message).not.toContain("is now shown");
        expect(answer.body.message).toContain("the confirmation card is being shown now");
        expect(langy.started).toEqual([]);
      });
    });
  });

  describe("given a raise claim that lapsed and was taken by another request", () => {
    it("leaves the newer request's claim in place when the first lets go", async () => {
      const target = {
        projectId: "proj_unit",
        conversationId: "conv_unit",
        resource: "evaluator",
        action: "delete",
        id: "ev_toxicity",
      };
      await confirmations.claimCardRaise({ target, token: "first", ttlSeconds: 30 });
      now += 31_000;
      await confirmations.claimCardRaise({ target, token: "second", ttlSeconds: 30 });

      await confirmations.releaseCardRaise({ target, token: "first" });

      expect(await confirmations.claimCardRaise({ target, token: "third", ttlSeconds: 30 })).toBe(
        false,
      );
    });
  });

  describe("given a person's own API key", () => {
    /** @scenario "Other keys are not asked for a click" */
    it("deletes without a card", async () => {
      const answer = await langy.deleteEvaluator("ev_toxicity", "personal");

      expect(answer.status).toBe(200);
      expect(langy.started).toEqual([]);
    });
  });

  describe("given an evaluator that does not exist", () => {
    /** @scenario "A delete of an item that does not exist shows no card" */
    it("lets the request through to the route's own answer and shows no card", async () => {
      const answer = await langy.deleteEvaluator("ev_missing");

      expect(answer.status).toBe(200);
      expect(langy.archived).toEqual(["ev_missing"]);
      expect(langy.started).toEqual([]);
    });
  });

  describe("given a bulk delete where the only record without a click does not exist", () => {
    it("spends the click of the one that does and lets the request through", async () => {
      await langy.deleteEvaluator("ev_toxicity");
      await langy.click({ id: "ev_toxicity", choice: "yes" });

      const bulk = await langy.deleteMany(["ev_toxicity", "ev_missing"]);
      const again = await langy.deleteEvaluator("ev_toxicity");

      expect([bulk.status, again.status]).toEqual([200, 409]);
      expect(langy.archived).toEqual(["ev_toxicity", "ev_missing"]);
      expect(langy.started).toHaveLength(2);
    });
  });

  describe("given an evaluator whose name runs over many lines and characters", () => {
    /** @scenario "The card names the item on one short line" */
    it("shows the name on one line, cut to 80 characters, with the end of its id", async () => {
      await langy.deleteEvaluator("ev_sprawling_a1b2");

      const { question } = await langy.cardFor("ev_sprawling_a1b2");
      const shown = /^Delete evaluator "(.*)" \(…a1b2\)\?$/.exec(question)?.[1];

      expect(shown).toBeDefined();
      expect(shown).toMatch(/^scratch copy x+…$/);
      expect(shown).toHaveLength(80);
    });
  });

  describe("given the person clicked Yes, and another request spends that click first", () => {
    /** @scenario "A click that another request spent first asks Langy to run again" */
    it("refuses with a plain ask to run the same command again, and shows no new card", async () => {
      const confirmations = LangyDeleteConfirmationMemoryRepository.create({ now: () => now });
      // Every spend loses the race, while the click itself is still there when it looks again.
      const losingEverySpend = new Proxy(confirmations, {
        get: (target, property) => {
          if (property === "consumeGrants") return async () => false;
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const racing = deleteConfirmationFixture({
        store: memorySessionState({ now: () => now }),
        confirmations: losingEverySpend,
        projectId: "proj_race",
        now: () => now,
      });
      await racing.bindKey("turn1", "turn_1");
      await racing.deleteEvaluator("ev_toxicity");
      await racing.click({ id: "ev_toxicity", choice: "yes" });

      const answer = await racing.deleteEvaluator("ev_toxicity");

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(answer.body.message).toContain("Run the same command again.");
      expect(racing.started).toHaveLength(1);
    });
  });

  describe("given the turn that showed the card has ended", () => {
    beforeEach(async () => {
      await langy.deleteEvaluator("ev_toxicity");
      langy.turn.current = null;
      await langy.waits.cancelTurn({ conversationId: langy.conversationId, turnId: "turn_1" });
    });

    describe("when the person clicks Yes on the card", () => {
      /** @scenario "A click after the turn ended still counts in the next turn" */
      it("counts for Langy's next turn, under a new key in the same conversation", async () => {
        await langy.click({ id: "ev_toxicity", choice: "yes" });
        await langy.bindKey("turn2", "turn_2");
        langy.turn.current = "turn_2";

        const answer = await langy.deleteEvaluator("ev_toxicity", "turn2");

        expect(langy.ended.map(({ outcome }) => outcome)).toEqual(["answered"]);
        expect(answer.status).toBe(200);
        expect(langy.archived).toEqual(["ev_toxicity"]);
      });
    });
  });

  describe("given the card is no longer waiting", () => {
    let waitId: string;

    beforeEach(async () => {
      await langy.deleteEvaluator("ev_toxicity");
      ({ waitId } = await langy.cardFor("ev_toxicity"));
      now += QUESTION_WAIT_BUDGET_MS + 1;
    });

    describe("when the person's click arrives as the message Chose: Yes", () => {
      /** @scenario "A click on a card that stopped waiting is sent as a message and still counts" */
      it("counts the click, once", async () => {
        await langy.sendMessage({
          text: "Chose: Yes, delete",
          selection: { waitId, optionId: "opt-1" },
        });
        await langy.sendMessage({
          text: "Chose: Yes, delete",
          selection: { waitId, optionId: "opt-1" },
        });

        const first = await langy.deleteEvaluator("ev_toxicity");
        const second = await langy.deleteEvaluator("ev_toxicity");

        expect([first.status, second.status]).toEqual([200, 409]);
      });
    });

    describe("when the click that arrives as a message picked No", () => {
      it("counts nothing, and a later Yes for the same card counts nothing either", async () => {
        await langy.sendMessage({
          text: "Chose: No, keep it",
          selection: { waitId, optionId: "opt-2" },
        });
        await langy.sendMessage({
          text: "Chose: Yes, delete",
          selection: { waitId, optionId: "opt-1" },
        });

        const answer = await langy.deleteEvaluator("ev_toxicity");

        expect(answer.status).toBe(409);
      });
    });
  });
});
