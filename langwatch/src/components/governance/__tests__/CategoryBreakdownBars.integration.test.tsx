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

import { CATEGORY_LABELS } from "~/server/app-layer/traces/block-classification/categories";
import {
  CATEGORY_BREAKDOWN_TOOLTIP_LABELS,
  CategoryBreakdownBars,
  CategoryBreakdownCaption,
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

  describe("given no categorized usage", () => {
    /** @scenario "The breakdown shows an enablement hint when no content was captured" */
    it("explains why the breakdown is empty in neutral terms with no link", () => {
      render(<CategoryBreakdownEnablementHint />, { wrapper: Wrapper });

      expect(
        screen.getByText(
          /no categorized usage in this window yet\. cost categories appear for coding-agent traffic captured with content\./i,
        ),
      ).toBeInTheDocument();
      // Neutral copy points at no setting — "payload capture" is internal
      // jargon and there is no such control in the product.
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.queryByText(/payload capture/i)).not.toBeInTheDocument();
    });
  });

  describe("<CategoryBreakdownCaption/>", () => {
    it("renders the summary with a keyboard-focusable (?) trigger", () => {
      render(<CategoryBreakdownCaption />, { wrapper: Wrapper });

      expect(
        screen.getByText(
          /where your tokens go: system prompt, mcp tools, skills, thinking, and more/i,
        ),
      ).toBeInTheDocument();
      // The (?) tooltip trigger is reachable by keyboard (tabIndex=0).
      const trigger = screen.getByLabelText("All content categories");
      expect(trigger).toHaveAttribute("tabindex", "0");
    });

    it("carries the complete taxonomy in the tooltip list, pinned to CATEGORY_LABELS", () => {
      // The tooltip list is derived from the taxonomy, so it can never drop a
      // category. This pins that: every human label the fold can emit is present.
      expect([...CATEGORY_BREAKDOWN_TOOLTIP_LABELS].sort()).toEqual(
        Object.values(CATEGORY_LABELS).sort(),
      );
    });
  });
});
