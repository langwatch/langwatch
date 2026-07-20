/**
 * @vitest-environment jsdom
 *
 * Translate action on the Summary tab's input/output panels
 * (specs/traces-v2/message-translation.feature). Renders the real
 * IOViewer with the real useTextTranslation hook; only the tRPC
 * boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  });
});
