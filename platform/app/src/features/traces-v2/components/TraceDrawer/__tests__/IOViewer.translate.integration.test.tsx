/**
 * @vitest-environment jsdom
 *
 * Translate action on the Summary tab's input/output panels
 * (specs/traces-v2/message-translation.feature). Renders the real
 * IOViewer with the real useTextTranslation hook; only the tRPC
 * boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

vi.mock(
  "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground",
  () => ({
    useGoToSpanInPlaygroundTabUrlBuilder: () => ({ buildUrl: () => null }),
  }),
);

const translateMock = vi.fn(
  async ({ textToTranslate }: { textToTranslate: string }) => ({
    translation: `TRANSLATED::${textToTranslate.slice(0, 20)}`,
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({
          mutateAsync: translateMock,
          isLoading: false,
        }),
      },
    },
  },
}));

import { IOViewer } from "../IOViewer";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  translateMock.mockClear();
});

describe("IOViewer translate action", () => {
  describe("when the user clicks Translate on a panel", () => {
    it("swaps the body to the translated content and back", async () => {
      const user = userEvent.setup();
      render(<IOViewer label="Output" content="Hej världen, det regnar" />, {
        wrapper,
      });

      await user.click(screen.getByRole("button", { name: /translate/i }));

      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej världen/)).toBeInTheDocument();
      });
      expect(translateMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        textToTranslate: "Hej världen, det regnar",
      });

      await user.click(screen.getByRole("button", { name: /show original/i }));
      expect(screen.getByText(/Hej världen, det regnar/)).toBeInTheDocument();
      expect(screen.queryByText(/TRANSLATED::/)).not.toBeInTheDocument();
    });

    it("does not refetch when re-translating cached content", async () => {
      const user = userEvent.setup();
      render(<IOViewer label="Output" content="Hej igen" />, { wrapper });

      await user.click(screen.getByRole("button", { name: /translate/i }));
      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej igen/)).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /show original/i }));
      await user.click(screen.getByRole("button", { name: /translate/i }));
      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej igen/)).toBeInTheDocument();
      });

      expect(translateMock).toHaveBeenCalledTimes(1);
    });

    it("fires a single batch when Translate is double-clicked mid-flight", async () => {
      const user = userEvent.setup();
      let release: (() => void) | undefined;
      translateMock.mockImplementationOnce(
        async ({ textToTranslate }: { textToTranslate: string }) => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { translation: `TRANSLATED::${textToTranslate.slice(0, 20)}` };
        },
      );
      render(<IOViewer label="Output" content="Hej stress" />, { wrapper });

      await user.click(screen.getByRole("button", { name: /translate/i }));
      // Mid-flight the button reads "Translating…" and is disabled;
      // fireEvent bypasses the pointer-events block so the toggle's own
      // in-flight guard is what keeps this from double-billing.
      fireEvent.click(screen.getByRole("button", { name: /translat/i }));
      release!();
      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej stress/)).toBeInTheDocument();
      });

      expect(translateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the panel content changes while the translation is shown", () => {
    it("resets to the new original with the button back on Translate", async () => {
      const user = userEvent.setup();
      const view = render(<IOViewer label="Output" content="Hej ett" />, {
        wrapper,
      });

      await user.click(screen.getByRole("button", { name: /translate/i }));
      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej ett/)).toBeInTheDocument();
      });

      view.rerender(<IOViewer label="Output" content="Hej två" />);

      expect(screen.getByText(/Hej två/)).toBeInTheDocument();
      expect(screen.queryByText(/TRANSLATED::/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /translate/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /show original/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the panel content is chat-shaped", () => {
    // Ends on a user turn — the Input panel trims trailing assistant
    // messages (those belong to the Output panel), and this test wants
    // both roles rendered.
    const chatContent = JSON.stringify([
      { role: "user", content: "Hej, vad är vädret idag?" },
      { role: "assistant", content: "Det regnar i Stockholm." },
      { role: "user", content: "Tack för hjälpen!" },
    ]);

    it("translates per message text and keeps the chat rendering and toggles", async () => {
      const user = userEvent.setup();
      render(<IOViewer label="Input" content={chatContent} />, { wrapper });

      await user.click(screen.getByRole("button", { name: /translate/i }));

      await waitFor(() => {
        expect(screen.getByText(/TRANSLATED::Hej, vad är/)).toBeInTheDocument();
      });
      expect(screen.getByText(/TRANSLATED::Det regnar/)).toBeInTheDocument();

      // Each message's prose is translated on its own — never the raw
      // JSON transcript (whose "translation" wouldn't parse as chat).
      expect(translateMock).toHaveBeenCalledTimes(3);
      expect(translateMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        textToTranslate: "Hej, vad är vädret idag?",
      });
      expect(translateMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        textToTranslate: "Det regnar i Stockholm.",
      });

      // The translated variant still parses as the same conversation, so
      // the json format toggle survives translation instead of dropping
      // out of the options.
      expect(screen.getByText("json")).toBeInTheDocument();
    });
  });
});
