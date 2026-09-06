/**
 * @vitest-environment jsdom
 *
 * The connect card opens the real GitHub App integration flow (the popup). When
 * the browser blocks that popup, it offers the in-app Settings route into the
 * SAME flow rather than dead-ending.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { LangyGitHubConnectCard } from "../components/github/LangyGitHubConnectCard";

function renderCard() {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <LangyGitHubConnectCard organizationId="org-1" />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  vi.restoreAllMocks();
});

describe("given the GitHub connect card", () => {
  describe("when it renders", () => {
    it("offers the install action", () => {
      renderCard();
      expect(screen.getByText("Install GitHub App")).toBeTruthy();
    });
  });

  describe("when the install popup is blocked", () => {
    it("offers the in-app settings route into the same flow", async () => {
      // A blocked popup — window.open returns null.
      vi.spyOn(window, "open").mockReturnValue(null);
      renderCard();
      fireEvent.click(screen.getByText("Install GitHub App"));

      const fallback = await screen.findByText("Install from settings");
      fireEvent.click(fallback);
      await waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith("/settings/integrations#github"),
      );
    });
  });
});
