/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BlockStack } from "../BlockStack";
import type { ContentBlock } from "../types";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("BlockStack", () => {
  describe("given a text block with prepended agent context", () => {
    const longContext =
      "<system-reminder>The following skills are available for use with the Skill tool, a long boilerplate list that exceeds eighty characters UNIQUE_TAIL_TOKEN</system-reminder>";
    const block: ContentBlock = {
      kind: "text",
      text: `${longContext}\n\nhi`,
    };

    /** @scenario "Prepended context is collapsed behind a disclosure in pretty mode" */
    it("shows the human text and collapses the context behind a disclosure", () => {
      render(<BlockStack blocks={[block]} toolCalls={[]} />, { wrapper });

      expect(screen.getByText("hi")).toBeInTheDocument();
      expect(
        screen.getByText("Hidden additional context"),
      ).toBeInTheDocument();
      // Collapsed: the bulky tail of the context is not rendered in full.
      expect(screen.queryByText(/UNIQUE_TAIL_TOKEN/)).not.toBeInTheDocument();
    });

    it("toggles to an expanded state when the disclosure is clicked", () => {
      render(<BlockStack blocks={[block]} toolCalls={[]} />, { wrapper });

      fireEvent.click(screen.getByText("Hidden additional context"));
      expect(screen.getByText("Hide additional context")).toBeInTheDocument();
    });
  });

  describe("given a plain text block with no prepended context", () => {
    it("renders the text directly with no disclosure", () => {
      const block: ContentBlock = { kind: "text", text: "just a normal hello" };
      render(<BlockStack blocks={[block]} toolCalls={[]} />, { wrapper });

      expect(screen.getByText("just a normal hello")).toBeInTheDocument();
      expect(
        screen.queryByText("Hidden additional context"),
      ).not.toBeInTheDocument();
    });
  });
});
