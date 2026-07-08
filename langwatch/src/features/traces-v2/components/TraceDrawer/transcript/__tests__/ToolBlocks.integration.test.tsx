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
    /** @scenario the transcript promotes a skill run with its name */
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

    it("falls back to the bare Skill label when no slug is present", () => {
      renderWithProviders(
        <ToolPairCard name="Skill" input={{}} result={null} />,
      );

      expect(screen.getByText("Skill")).toBeInTheDocument();
    });
  });

  describe("when the tool_use is an ordinary tool", () => {
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
