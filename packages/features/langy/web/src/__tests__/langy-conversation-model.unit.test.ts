/**
 * A model pick lives with its conversation. `followConversationModel` seeds
 * the picker from the durable record when a conversation's history lands, and
 * switching conversations resets the pick so it never leaks across.
 *
 * @see specs/langy/langy-model-selection.feature
 *      "Reopening a conversation restores the model it last ran on"
 *      "A new conversation starts on the resolved default again"
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyStore } from "../behavior/langy.store";

const DEFAULT = "openai_codex/gpt-5.6-terra";

describe("followConversationModel", () => {
  beforeEach(() => {
    useLangyStore.setState({
      activeConversationId: "conv-1",
      modelOverride: "",
      isModelPickedByUser: false,
      modelSeededForConversationId: null,
    });
  });

  describe("when the picker still sits on the seeded default", () => {
    it("restores the conversation's last model over an empty pick", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe("custom/stealth/ox-alpha");
    });

    it("restores it over the panel-seeded default too", () => {
      useLangyStore.getState().setModelOverride(DEFAULT);

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe("custom/stealth/ox-alpha");
    });
  });

  describe("when the user picked a model since opening the conversation", () => {
    it("never replaces the pick", () => {
      useLangyStore.getState().pickModel("anthropic/claude-sonnet-5");

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe("anthropic/claude-sonnet-5");
    });

    /** @scenario A pick that matches the default is still the user's pick */
    it("keeps a pick that happens to be the resolved default", () => {
      // Picking the model that is (or just became) the project default is the
      // one case where "the pill equals the default" cannot tell a choice from
      // a seed. The pick is what the user is looking at, so it wins.
      useLangyStore.getState().pickModel(DEFAULT);

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe(DEFAULT);
    });
  });

  describe("when the same history lands again", () => {
    it("seeds only once per conversation selection", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });
      useLangyStore.getState().pickModel("openai/gpt-5-mini");

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe("openai/gpt-5-mini");
    });
  });

  describe("when the history belongs to another conversation", () => {
    it("does not touch the picker", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-2",
        model: "custom/stealth/ox-alpha",
      });

      expect(useLangyStore.getState().modelOverride).toBe("");
    });
  });
});

describe("switching conversations", () => {
  beforeEach(() => {
    useLangyStore.setState({
      activeConversationId: "conv-1",
      modelOverride: "custom/stealth/ox-alpha",
      isModelPickedByUser: true,
      modelSeededForConversationId: "conv-1",
    });
  });

  /** @scenario A new conversation starts on the resolved default again */
  it("startNewConversation drops the pick back to the default", () => {
    useLangyStore.getState().startNewConversation();

    const state = useLangyStore.getState();
    expect(state.modelOverride).toBe("");
    expect(state.isModelPickedByUser).toBe(false);
    expect(state.modelSeededForConversationId).toBeNull();
  });

  it("selectConversation leaves the pick behind with its conversation", () => {
    useLangyStore.getState().selectConversation("conv-2");

    const state = useLangyStore.getState();
    expect(state.modelOverride).toBe("");
    expect(state.isModelPickedByUser).toBe(false);
    expect(state.modelSeededForConversationId).toBeNull();
  });

  /** @scenario A new conversation starts on the resolved default again */
  it("askLangy hands over a fresh conversation on the default too", () => {
    useLangyStore.getState().askLangy("what is this chart telling me?");

    const state = useLangyStore.getState();
    expect(state.modelOverride).toBe("");
    expect(state.isModelPickedByUser).toBe(false);
    expect(state.modelSeededForConversationId).toBeNull();
    expect(state.pendingPrompt).toBe("what is this chart telling me?");
  });
});
