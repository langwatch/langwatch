/**
 * @vitest-environment jsdom
 *
 * The category cost-breakdown lanes shared by the /me usage view and the org
 * Activity Monitor (ADR-033 PR D). Renders human-readable category labels with
 * their cost + share, and an enablement hint when nothing was captured.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CategoryBreakdownBars,
  CategoryBreakdownEnablementHint,
} from "../CategoryBreakdownBars";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<CategoryBreakdownBars/>", () => {
  afterEach(cleanup);

  describe("given classified category totals", () => {
    /** @scenario "The personal usage view shows the user's cost breakdown by category" */
    it("lists each category by its human label with cost and percent share", () => {
      render(
        <CategoryBreakdownBars
          rows={[
            {
              category: "mcp_tool_definitions",
              label: "MCP tool definitions",
              costUsd: 0.6,
              tokens: 600,
              sharePct: 60,
            },
            {
              category: "system_prompt",
              label: "System prompt",
              costUsd: 0.4,
              tokens: 400,
              sharePct: 40,
            },
          ]}
        />,
        { wrapper: Wrapper },
      );

      // Human labels, not the raw wire enum values.
      expect(screen.getByText("MCP tool definitions")).toBeInTheDocument();
      expect(screen.getByText("System prompt")).toBeInTheDocument();
      expect(
        screen.queryByText("mcp_tool_definitions"),
      ).not.toBeInTheDocument();
      // Share percentages surface.
      expect(screen.getByText("60%")).toBeInTheDocument();
      expect(screen.getByText("40%")).toBeInTheDocument();
    });
  });

  describe("given no captured content", () => {
    /** @scenario "The breakdown shows an enablement hint when no content was captured" */
    it("explains payload capture must be enabled and links to the settings", () => {
      render(<CategoryBreakdownEnablementHint settingsHref="/me/configure" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText(/payload capture/i)).toBeInTheDocument();
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/me/configure");
    });
  });
});
