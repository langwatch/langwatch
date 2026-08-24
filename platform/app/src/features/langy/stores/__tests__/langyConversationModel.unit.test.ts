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

import { useLangyStore } from "../langyStore";

const DEFAULT = "openai_codex/gpt-5.6-terra";

describe("followConversationModel", () => {
  beforeEach(() => {
    useLangyStore.setState({
      activeConversationId: "conv-1",
      modelOverride: "",
      modelSeededForConversationId: null,
    });
  });

  describe("when the picker still sits on the seeded default", () => {
    it("restores the conversation's last model over an empty pick", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
      });

      expect(useLangyStore.getState().modelOverride).toBe(
        "custom/stealth/ox-alpha",
      );
    });

    it("restores it over the panel-seeded default too", () => {
      useLangyStore.setState({ modelOverride: DEFAULT });

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
      });

      expect(useLangyStore.getState().modelOverride).toBe(
        "custom/stealth/ox-alpha",
      );
    });
  });

  describe("when the user picked a model since opening the conversation", () => {
    it("never replaces the pick", () => {
      useLangyStore.setState({ modelOverride: "anthropic/claude-sonnet-5" });

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
      });

      expect(useLangyStore.getState().modelOverride).toBe(
        "anthropic/claude-sonnet-5",
      );
    });
  });

  describe("when the same history lands again", () => {
    it("seeds only once per conversation selection", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
      });
      useLangyStore.getState().setModelOverride("openai/gpt-5-mini");

      useLangyStore.getState().followConversationModel({
        conversationId: "conv-1",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
      });

      expect(useLangyStore.getState().modelOverride).toBe("openai/gpt-5-mini");
    });
  });

  describe("when the history belongs to another conversation", () => {
    it("does not touch the picker", () => {
      useLangyStore.getState().followConversationModel({
        conversationId: "conv-2",
        model: "custom/stealth/ox-alpha",
        resolvedDefault: DEFAULT,
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
      modelSeededForConversationId: "conv-1",
    });
  });

  /** @scenario A new conversation starts on the resolved default again */
  it("startNewConversation drops the pick back to the default", () => {
    useLangyStore.getState().startNewConversation();

    const state = useLangyStore.getState();
    expect(state.modelOverride).toBe("");
    expect(state.modelSeededForConversationId).toBeNull();
  });

  it("selectConversation leaves the pick behind with its conversation", () => {
    useLangyStore.getState().selectConversation("conv-2");

    const state = useLangyStore.getState();
    expect(state.modelOverride).toBe("");
    expect(state.modelSeededForConversationId).toBeNull();
  });
});
