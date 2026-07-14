import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_DRAFT } from "../../logic/draftReducer";
import { MAX_TEST_HISTORY, useAutomationStore } from "../automationStore";

describe("automationStore", () => {
  describe("given a fresh store", () => {
    beforeEach(() => {
      useAutomationStore.getState().reset();
    });

    it("starts fresh", () => {
      const { draft, section, testHistory } = useAutomationStore.getState();
      expect(draft).toEqual(INITIAL_DRAFT);
      expect(section).toBeNull();
      expect(testHistory).toEqual([]);
    });

    describe("when dispatch is called", () => {
      it("runs the reducer", () => {
        useAutomationStore
          .getState()
          .dispatch({ type: "SET_ACTION", value: TriggerAction.SEND_EMAIL });
        expect(useAutomationStore.getState().draft.action).toBe(
          TriggerAction.SEND_EMAIL,
        );
      });
    });

    describe("when setSection is called", () => {
      it("updates the open secondary", () => {
        useAutomationStore.getState().setSection("filters");
        expect(useAutomationStore.getState().section).toBe("filters");
      });
    });

    describe("when pushTestAttempt is called past the cap", () => {
      it("prepends and caps at MAX_TEST_HISTORY", () => {
        const push = useAutomationStore.getState().pushTestAttempt;
        for (let i = 0; i < MAX_TEST_HISTORY + 2; i++) {
          push({
            at: i,
            channel: "email",
            status: "success",
            recipientCount: 1,
          });
        }
        const { testHistory } = useAutomationStore.getState();
        expect(testHistory).toHaveLength(MAX_TEST_HISTORY);
        // Most recent first.
        expect(testHistory[0]!.at).toBe(MAX_TEST_HISTORY + 1);
      });
    });

    describe("when hydrate is called", () => {
      it("replaces the draft", () => {
        const replacement = { ...INITIAL_DRAFT, name: "Hydrated" };
        useAutomationStore.getState().hydrate(replacement);
        expect(useAutomationStore.getState().draft.name).toBe("Hydrated");
      });
    });

    describe("when reset is called after edits", () => {
      it("wipes draft + section + history", () => {
        useAutomationStore.getState().setSection("filters");
        useAutomationStore.getState().pushTestAttempt({
          at: 1,
          channel: "email",
          status: "success",
          recipientCount: 1,
        });
        useAutomationStore.getState().reset();
        const { draft, section, testHistory } = useAutomationStore.getState();
        expect(draft).toEqual(INITIAL_DRAFT);
        expect(section).toBeNull();
        expect(testHistory).toEqual([]);
      });
    });
  });
});
