/**
 * @vitest-environment jsdom
 *
 * Unbreakable strings (URLs, JSON blobs, base64) must wrap inside the
 * containers that render them instead of painting past their box. The wrap
 * rule lives on the shared roots: Prose for Markdown output and the raw mono
 * fallbacks in RenderInputOutput.
 *
 * jsdom cannot read Chakra's layered atomic CSS through getComputedStyle, so
 * the Prose assertions run against PROSE_BASE, the object the recipe ships,
 * while the RenderInputOutput assertion renders for real.
 *
 * Feature: specs/traces-v2/unbreakable-text-wrap.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { Markdown } from "~/components/Markdown";
import { RenderInputOutput } from "~/components/traces/RenderInputOutput";
import { PROSE_BASE } from "~/components/ui/prose";

const UNBREAKABLE = "x".repeat(500);

function withProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

afterEach(cleanup);

describe("given a markdown message body", () => {
  describe("when it holds one unbreakable token", () => {
    /** @scenario "A message body carries the wrap rule to every prose element" */
    it("the Prose root carries overflow-wrap anywhere so every prose element inherits it", () => {
      expect(PROSE_BASE.overflowWrap).toBe("anywhere");
    });
  });

  describe("when it contains a fenced code block", () => {
    /** @scenario "Fenced code blocks scroll instead of breaking mid-token" */
    it("the pre rule keeps horizontal scrolling and resets the inherited wrap", () => {
      const preKey = Object.keys(PROSE_BASE).find((key) =>
        key.includes(":where(pre)"),
      );
      expect(preKey).toBeDefined();
      const preStyle = PROSE_BASE[preKey as keyof typeof PROSE_BASE] as Record<
        string,
        string
      >;
      expect(preStyle.overflowX).toBe("auto");
      expect(preStyle.overflowWrap).toBe("normal");
    });

    it("renders markdown with a fenced block without crashing", () => {
      const fenced = `\`\`\`\n${UNBREAKABLE}\n\`\`\``;
      withProviders(<Markdown>{fenced}</Markdown>);
      expect(
        screen.getByText(new RegExp(UNBREAKABLE.slice(0, 40))),
      ).toBeInTheDocument();
    });
  });
});

describe("given a raw tool input or output string outside the JSON viewer", () => {
  /** @scenario "Raw tool input and output strings wrap instead of painting wide" */
  it("the mono fallback carries word-break break-word", () => {
    withProviders(
      <RenderInputOutput value={`https://host.example/${UNBREAKABLE}`} />,
    );

    const raw = screen.getByText(new RegExp(UNBREAKABLE.slice(0, 40)));
    expect(raw).toHaveStyle({ wordBreak: "break-word" });
  });
});
