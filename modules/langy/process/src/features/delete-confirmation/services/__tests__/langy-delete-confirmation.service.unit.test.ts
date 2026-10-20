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

beforeEach(async () => {
  now = 1_760_000_000_000;
  const clock = () => now;
  langy = deleteConfirmationFixture({
    store: memorySessionState({ now: clock }),
    confirmations: LangyDeleteConfirmationMemoryRepository.create({ now: clock }),
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
      it("still refuses the delete", async () => {
        await langy.sendMessage({ text: "yes" });
        await langy.sendMessage({ text: "Chose: Yes, delete" });

        const answer = await langy.deleteEvaluator("ev_toxicity");

        expect(answer).toMatchObject({
          status: 409,
          body: { code: "langy_confirmation_required" },
        });
        expect(langy.archived).toEqual([]);
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
  });

  describe("given a person's own API key", () => {
    it("deletes without a card", async () => {
      const answer = await langy.deleteEvaluator("ev_toxicity", "personal");

      expect(answer.status).toBe(200);
      expect(langy.started).toEqual([]);
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
