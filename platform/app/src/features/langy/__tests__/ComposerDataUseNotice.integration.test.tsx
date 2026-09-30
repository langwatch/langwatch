/**
 * @vitest-environment jsdom
 *
 * The composer's note that LangWatch uses the chats to improve Langy shows on
 * LangWatch Cloud only; a self-hosted install sends no chats to LangWatch.
 *
 * Spec: specs/langy/langy-composer-data-use-notice.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/LangyModelPill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { COMPOSER_DATA_USE_NOTICE, Composer } from "../components/Composer";
import { LangyChatsImproveLangyContext } from "../langyDataUse";

function renderComposer({ chatsImproveLangy }: { chatsImproveLangy: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyChatsImproveLangyContext.Provider value={chatsImproveLangy}>
        <Composer
          model="openai/gpt-5-mini"
          modelOptions={["openai/gpt-5-mini"]}
          onModelChange={() => {}}
          onSend={() => {}}
          onStop={() => {}}
          disabled={false}
        />
      </LangyChatsImproveLangyContext.Provider>
    </ChakraProvider>,
  );
}

describe("given the Langy composer", () => {
  afterEach(cleanup);

  describe("when it renders on a self-hosted install", () => {
    /** @scenario "The Langy composer on a self-hosted install does not say chats go to LangWatch" */
    it("carries no data use note", () => {
      renderComposer({ chatsImproveLangy: false });
      expect(screen.queryByText(COMPOSER_DATA_USE_NOTICE)).toBeNull();
    });
  });

  describe("when it renders on LangWatch Cloud", () => {
    /** @scenario "The Langy composer on LangWatch Cloud says chats are used to improve Langy" */
    it("carries the data use note", () => {
      renderComposer({ chatsImproveLangy: true });
      expect(screen.getByText(COMPOSER_DATA_USE_NOTICE)).toBeTruthy();
    });
  });
});
