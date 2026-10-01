/**
 * The note that LangWatch uses the chats to improve Langy shows on LangWatch Cloud only.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-composer-data-use-notice.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Ark's auto-resizing textarea reaches for ResizeObserver on mount; jsdom has none.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

const deployment = { isSaaS: false };

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiDeployment: () => deployment,
}));
vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { COMPOSER_DATA_USE_NOTICE, Composer } from "../composer.tsx";

function renderComposer({ isSaaS }: { isSaaS: boolean }) {
  deployment.isSaaS = isSaaS;
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

describe("given the Langy composer", () => {
  afterEach(cleanup);

  describe("when it renders on a self-hosted install", () => {
    /** @scenario "The Langy composer on a self-hosted install does not say chats go to LangWatch" */
    it("carries no data use note", () => {
      renderComposer({ isSaaS: false });
      expect(screen.queryByText(COMPOSER_DATA_USE_NOTICE)).toBeNull();
    });
  });

  describe("when it renders on LangWatch Cloud", () => {
    /** @scenario "The Langy composer on LangWatch Cloud says chats are used to improve Langy" */
    it("carries the data use note", () => {
      renderComposer({ isSaaS: true });
      expect(screen.getByText(COMPOSER_DATA_USE_NOTICE)).toBeTruthy();
    });
  });
});
