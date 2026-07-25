/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolPairCard } from "../ToolBlocks";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<ToolPairCard />", () => {
  afterEach(() => cleanup());

  describe("when the tool_use is a skill invocation", () => {
    /** @scenario "A skill run shows the invoked skill name" */
    it("renders the invoked skill name in the header", () => {
      renderWithProviders(
        <ToolPairCard
          name="Skill"
          input={{ skill: "surf-pr", args: "" }}
          result={null}
        />,
      );

      expect(screen.getByText("Skill · surf-pr")).toBeInTheDocument();
    });

    /** @scenario "A skill run without a resolvable slug falls back to a bare label" */
    it("falls back to the bare Skill label when no slug is present", () => {
      renderWithProviders(
        <ToolPairCard name="Skill" input={{}} result={null} />,
      );

      expect(screen.getByText("Skill")).toBeInTheDocument();
    });
  });

  describe("when the tool_use is an ordinary tool", () => {
    /** @scenario "An ordinary tool call is not treated as a skill" */
    it("renders the tool name plainly, not as a skill", () => {
      renderWithProviders(
        <ToolPairCard
          name="Bash"
          input={{ command: "ls -la" }}
          result={null}
        />,
      );

      expect(screen.getByText("Bash")).toBeInTheDocument();
      expect(screen.queryByText(/Skill ·/)).toBeNull();
      // Primary-arg summary still surfaces for ordinary tools.
      expect(screen.getByText("ls -la")).toBeInTheDocument();
    });
  });
});
