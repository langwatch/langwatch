/**
 * @vitest-environment jsdom
 *
 * The composer's rainbow sheen (`.langy-composer-sheen`) is an ACTIVITY signal:
 * lit for exactly as long as a turn is in flight, dark at rest. It used to be
 * the inverse — an invitation that showed only on a blank, never-used composer
 * and dropped the instant you sent — so this pins the direction, in both
 * senses, to stop it flipping back by accident.
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

function renderComposer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

const sheen = (container: HTMLElement) =>
  container.querySelector(".langy-composer-sheen");

const resetStore = () =>
  useLangyStore.setState({
    activeConversationId: null,
    draft: "",
    turnPhase: "idle",
  });

describe("given the Langy composer sheen", () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    resetStore();
  });

  describe("when the conversation is empty and idle", () => {
    it("stays dark, because nothing is happening", () => {
      const { container } = renderComposer();
      expect(sheen(container)).toBeNull();
    });
  });

  describe("when an adopted conversation is sitting idle", () => {
    it("stays dark", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "idle",
      });
      const { container } = renderComposer();
      expect(sheen(container)).toBeNull();
    });
  });

  describe("when a turn is in flight", () => {
    it("lights the sheen", () => {
      useLangyStore.setState({ turnPhase: "active" });
      const { container } = renderComposer();
      expect(sheen(container)).not.toBeNull();
    });
  });

  describe("when a stop has been requested but the backend has not confirmed", () => {
    it("keeps the sheen lit through the stopping window", () => {
      useLangyStore.setState({ turnPhase: "stopping" });
      const { container } = renderComposer();
      expect(sheen(container)).not.toBeNull();
    });
  });
});
