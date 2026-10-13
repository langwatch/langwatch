/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../testing.tsx";
import { ExternalToolTile } from "../ui/blocks/external-tool-tile.tsx";
import { PersonalTracesEmptyState } from "../ui/blocks/personal-traces-empty-state.tsx";

afterEach(cleanup);

describe("given the personal activity has no traces", () => {
  describe("when the reader looks at the setup offers", () => {
    it("opens the API-key offer as a link and the in-page offers as buttons", () => {
      renderWithPersonalWorkspaceHost(<PersonalTracesEmptyState projectSlug="jane-personal" />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.getByRole("link", { name: "Create an API key" }).getAttribute("href")).toBe(
        "/settings/api-keys",
      );
      expect(screen.getByRole("button", { name: "Set up a coding assistant" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Mint an ingestion key" })).toBeTruthy();
    });

    it("scrolls to the matching section when an in-page offer is chosen", async () => {
      const scrollIntoView = vi.fn();
      const target = document.createElement("div");
      target.id = "me-ai-tools";
      target.scrollIntoView = scrollIntoView;
      document.body.append(target);
      renderWithPersonalWorkspaceHost(<PersonalTracesEmptyState projectSlug="jane-personal" />, {
        host: fakePersonalWorkspaceHost(),
      });

      await userEvent.click(screen.getByRole("button", { name: "Set up a coding assistant" }));

      expect(scrollIntoView).toHaveBeenCalledOnce();
      target.remove();
    });
  });
});

describe("given an internal tool in the AI tools portal", () => {
  describe("when the reader opens it from the keyboard", () => {
    it("reveals the tool link and reports the disclosure state", async () => {
      renderWithPersonalWorkspaceHost(
        <ExternalToolTile
          displayName="Wiki"
          config={{ descriptionMarkdown: "Team wiki", linkUrl: "https://wiki.example" }}
        />,
        { host: fakePersonalWorkspaceHost() },
      );

      const toggle = screen.getByRole("button", { name: "Show details for Wiki" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("link", { name: /Open Wiki/ })).toBeNull();

      toggle.focus();
      fireEvent.click(toggle);

      expect(
        screen.getByRole("button", { name: "Hide details for Wiki" }).getAttribute("aria-expanded"),
      ).toBe("true");
      expect(screen.getByRole("link", { name: /Open Wiki/ }).getAttribute("href")).toBe(
        "https://wiki.example",
      );
    });
  });
});
