/**
 * @vitest-environment jsdom
 * Spec: modules/navigation/specs/whats-new.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { UserWhatsNewEntry } from "@langwatch/user-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const reading: { entries: UserWhatsNewEntry[] } = { entries: [] };
const markSeen = vi.fn();

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    user: {
      whatsNew: { useQuery: () => ({ data: reading }) },
      markWhatsNewSeen: { useMutation: () => ({ mutate: markSeen }) },
    },
  },
}));

import { WhatsNewMenu } from "../whats-new-menu.tsx";

const ENTRY: UserWhatsNewEntry = {
  id: "https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer",
  title: "Instant evals in the trace explorer",
  url: "https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer",
  publishedAt: "Sun, 27 Sep 2026 00:00:00 GMT",
  imageUrl: "https://langwatch.ai/changelog/instant-evals-in-the-trace-explorer/01.png",
  features: [
    { text: "Instant Evals in the search bar", url: "https://langwatch.ai/changelog/a" },
    { text: "Langy drives the Trace Explorer", url: "https://langwatch.ai/changelog/b" },
  ],
  seen: false,
};

afterEach(() => {
  cleanup();
  markSeen.mockReset();
  reading.entries = [];
});

describe("<WhatsNewMenu/>", () => {
  /** @scenario "The latest changelog entry shows behind a sidebar button" */
  it("opens a card with the entry, its screenshot, its lines and the read button", async () => {
    reading.entries = [ENTRY];
    renderWithDesignSystem(<WhatsNewMenu />);

    await userEvent.setup().click(screen.getByRole("button", { name: "What's new" }));

    await waitFor(() => expect(screen.getByText(ENTRY.title)).toBeVisible());
    expect(screen.getByRole("img", { name: ENTRY.title })).toHaveAttribute("src", ENTRY.imageUrl);
    expect(screen.getByRole("link", { name: "Langy drives the Trace Explorer" })).toHaveAttribute(
      "href",
      "https://langwatch.ai/changelog/b",
    );
    expect(screen.getByRole("link", { name: /Read the update/ })).toHaveAttribute(
      "href",
      ENTRY.url,
    );
  });

  it("shows a dot until the card is opened, and marks the entry seen", async () => {
    reading.entries = [ENTRY];
    renderWithDesignSystem(<WhatsNewMenu />);
    expect(screen.getByTestId("whats-new-dot")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "What's new" }));

    expect(markSeen).toHaveBeenCalledWith({ entryId: ENTRY.id });
    expect(screen.queryByTestId("whats-new-dot")).not.toBeInTheDocument();
  });

  it("shows no dot for an entry already seen", () => {
    reading.entries = [{ ...ENTRY, seen: true }];
    renderWithDesignSystem(<WhatsNewMenu />);
    expect(screen.queryByTestId("whats-new-dot")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no entry", () => {
    renderWithDesignSystem(<WhatsNewMenu />);
    expect(screen.queryByRole("button", { name: "What's new" })).not.toBeInTheDocument();
  });
});
