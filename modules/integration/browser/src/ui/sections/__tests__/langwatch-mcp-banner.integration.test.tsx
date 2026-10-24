/**
 * @vitest-environment jsdom
 * The LangWatch MCP callout at the top of Integrations: the docs link, and Langy when installed.
 * Spec: modules/integration/specs/langwatch-mcp-banner.feature
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeGithubHost, renderWithGithubHost } from "../../../testing.tsx";
import {
  LANGWATCH_MCP_DOCS_URL,
  LANGWATCH_MCP_LANGY_QUESTION,
  LangwatchMcpBanner,
} from "../langwatch-mcp-banner.tsx";

afterEach(() => {
  cleanup();
});

describe("the LangWatch MCP banner", () => {
  describe("when the Integrations page renders", () => {
    /** @scenario "The banner points to the MCP docs" */
    it("says how to use LangWatch from AI clients and links to the docs in a new tab", () => {
      renderWithGithubHost(<LangwatchMcpBanner />);

      expect(screen.getByText("Looking to add the LangWatch MCP?")).toBeInTheDocument();
      expect(
        screen.getByText(/Use LangWatch from Claude, Cursor, ChatGPT and more/),
      ).toBeInTheDocument();
      const docs = screen.getByRole("link", { name: "See how in the docs" });
      expect(docs).toHaveAttribute("href", LANGWATCH_MCP_DOCS_URL);
      expect(docs).toHaveAttribute("target", "_blank");
    });
  });

  describe("when Langy is installed and the person clicks Ask Langy", () => {
    /** @scenario "Ask Langy opens Langy with the MCP question" */
    it("asks Langy to help connect the LangWatch MCP", async () => {
      const user = userEvent.setup();
      const { host } = renderWithGithubHost(<LangwatchMcpBanner />);

      await user.click(screen.getByRole("button", { name: "Ask Langy" }));

      expect(host.langyQuestions).toEqual([LANGWATCH_MCP_LANGY_QUESTION]);
    });
  });

  describe("when Langy is not installed", () => {
    /** @scenario "Without Langy the banner offers only the docs" */
    it("offers the docs link and no Ask Langy button", () => {
      renderWithGithubHost(<LangwatchMcpBanner />, new FakeGithubHost({ langy: false }));

      expect(screen.queryByRole("button", { name: "Ask Langy" })).toBeNull();
      expect(screen.getByRole("link", { name: "See how in the docs" })).toBeInTheDocument();
    });
  });
});
