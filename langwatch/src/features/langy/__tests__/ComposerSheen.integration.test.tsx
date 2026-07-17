/**
 * @vitest-environment jsdom
 *
 * The composer's rainbow sheen (`.langy-composer-sheen`) is an invitation on a
 * blank, idle composer. It must drop the moment the conversation has anything
 * in it — a turn in flight, or a conversation already adopted — so it never
 * competes with the answer. This pins that toggle.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cut the model picker's dependency chain — this test is about the sheen, not
// the picker. Mocking the pill by the specifier the composer imports keeps the
// render tiny and deterministic.
vi.mock("../components/LangyModelPill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { Composer } from "../components/Composer";
import { useLangyStore } from "../stores/langyStore";

function renderComposer(overrides: Partial<{ isBusy: boolean }> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        isBusy={overrides.isBusy ?? false}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

const sheen = (container: HTMLElement) =>
  container.querySelector(".langy-composer-sheen");

describe("given the Langy composer sheen", () => {
  beforeEach(() => {
    useLangyStore.setState({ activeConversationId: null, draft: "" });
  });
  afterEach(() => {
    cleanup();
    useLangyStore.setState({ activeConversationId: null, draft: "" });
  });

  describe("when the conversation is empty and idle", () => {
    it("shows the inviting rainbow sheen", () => {
      const { container } = renderComposer();
      expect(sheen(container)).not.toBeNull();
    });
  });

  describe("when a conversation has been adopted", () => {
    it("drops the sheen", () => {
      useLangyStore.setState({ activeConversationId: "conv-1" });
      const { container } = renderComposer();
      expect(sheen(container)).toBeNull();
    });
  });

  describe("when a turn is in flight before the conversation is adopted", () => {
    it("drops the sheen", () => {
      const { container } = renderComposer({ isBusy: true });
      expect(sheen(container)).toBeNull();
    });
  });
});
