/**
 * The connect card opens the real GitHub App integration flow (the popup).
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pushMock, connection } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  connection: { configured: true, isLoading: false },
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("../../../../behavior/github-connect-popup.ts", () => ({
  useGitHubConnectPopup: () => ({
    connect: async () => ({ ok: false, reason: "popup-blocked" }),
  }),
}));

vi.mock("../../../../../../behavior/langy-api.ts", () => ({
  api: {
    github: {
      getConnectionStatus: {
        useQuery: () =>
          connection.isLoading
            ? { data: undefined, isLoading: true }
            : { data: { configured: connection.configured }, isLoading: false },
      },
    },
  },
}));

import { LangyGitHubConnectCard } from "../langy-git-hub-connect-card.tsx";

function renderCard(onShareLocalFolder?: () => void) {
  return render(
    <MemoryRouter>
      <DesignSystemProvider forcedTheme="light">
        <LangyGitHubConnectCard
          organizationId="org-1"
          {...(onShareLocalFolder ? { onShareLocalFolder } : {})}
        />
      </DesignSystemProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  connection.configured = true;
  connection.isLoading = false;
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
      renderCard();
      fireEvent.click(screen.getByText("Install GitHub App"));

      const fallback = await screen.findByText("Install from settings");
      fireEvent.click(fallback);
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/settings/integrations#github"));
    });
  });
});

describe("given an instance with no GitHub App configured", () => {
  describe("when the connect card renders", () => {
    /** @scenario "Langy offers the local folder when GitHub is not set up on the instance" */
    it("offers sharing a local folder and no install action", () => {
      connection.configured = false;
      const share = vi.fn();
      renderCard(share);

      expect(screen.getByText("GitHub is not set up on this instance")).toBeTruthy();
      expect(screen.queryByText("Install GitHub App")).toBeNull();
      fireEvent.click(screen.getByText("Share local folder"));
      expect(share).toHaveBeenCalledOnce();
    });
  });
});

describe("given the connection status has not answered yet", () => {
  it("shows neither the install nor the not set up card", () => {
    connection.isLoading = true;
    renderCard(vi.fn());

    expect(screen.queryByText("Install GitHub App")).toBeNull();
    expect(screen.queryByText("GitHub is not set up on this instance")).toBeNull();
  });
});
