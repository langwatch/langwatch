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
  CategoryBreakdownErrorHint,
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

  describe("given an all-zero-cost set (only free/bundled traffic)", () => {
    it("renders every lane without a NaN width via the maxCost floor", () => {
      // maxCost = Math.max(...costs, 0.000001) keeps widthPct finite when every
      // lane is $0 — the guard the pre-baked-rows test above never exercises.
      render(
        <CategoryBreakdownBars
          rows={[
            {
              category: "system_prompt",
              label: "System prompt",
              costUsd: 0,
              tokens: 500,
              sharePct: 0,
            },
            {
              category: "user_input",
              label: "User input",
              costUsd: 0,
              tokens: 300,
              sharePct: 0,
            },
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("System prompt")).toBeInTheDocument();
      // A NaN width would serialize into the style string; assert none leaked.
      for (const bar of document.querySelectorAll<HTMLElement>("[style]")) {
        expect(bar.getAttribute("style") ?? "").not.toContain("NaN");
      }
    });
  });

  describe("given the breakdown fetch failed", () => {
    it("shows a neutral error state, not the 'no usage' hint", () => {
      render(<CategoryBreakdownErrorHint />, { wrapper: Wrapper });

      expect(
        screen.getByText(
          /couldn’t load the usage breakdown\. try again shortly\./i,
        ),
      ).toBeInTheDocument();
      // Must NOT claim there was no usage — that's a false statement on error.
      expect(
        screen.queryByText(/no categorized usage/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given no categorized usage", () => {
    /** @scenario "The breakdown shows an enablement hint when no content was captured" */
    it("explains why the breakdown is empty in neutral terms with no link", () => {
      render(<CategoryBreakdownEnablementHint />, { wrapper: Wrapper });

      expect(
        screen.getByText(
          /no categorized coding-agent usage in this window yet\. this view covers only coding-agent traffic captured with content, so it can stay empty even when your total ai spend is not\./i,
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
