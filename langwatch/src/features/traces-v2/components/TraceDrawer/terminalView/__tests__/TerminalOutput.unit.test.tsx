/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalOutput } from "../TerminalOutput";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// A real `git status` fragment: "main" is green, the modified line is red.
const GIT_STATUS =
  "On branch \x1b[32mmain\x1b[0m\n\x1b[31m\tmodified:   file.ts\x1b[0m";

describe("TerminalOutput", () => {
  describe("given output containing ANSI escape codes", () => {
    it("renders the clean text without any escape codes leaking through", () => {
      const { container } = render(<TerminalOutput text={GIT_STATUS} />, {
        wrapper,
      });
      // Escape bytes and SGR fragments must not reach the DOM text.
      expect(container.textContent).not.toContain("\x1b");
      expect(container.textContent).not.toContain("[32m");
      expect(container.textContent).toContain("On branch main");
      expect(container.textContent).toContain("modified:   file.ts");
    });

    it("wraps a coloured run in its own styled span", () => {
      render(<TerminalOutput text={GIT_STATUS} />, { wrapper });
      // "main" was green, so it renders as its own <span> (coloured runs get a
      // wrapper; plain runs stay bare text nodes).
      const greenRun = screen.getByText("main");
      expect(greenRun.tagName).toBe("SPAN");
    });
  });

  describe("given a plain (non-ANSI) tool output", () => {
    it("renders it verbatim as monospace text", () => {
      const { container } = render(
        <TerminalOutput text={"just plain lines\nsecond line"} />,
        { wrapper },
      );
      expect(container.textContent).toContain("just plain lines");
      expect(container.textContent).toContain("second line");
    });
  });

  describe("when the copy button is clicked", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
    });

    it("copies the de-ANSI'd text, not the escape codes", () => {
      render(<TerminalOutput text={GIT_STATUS} />, { wrapper });
      fireEvent.click(screen.getByRole("button", { name: "Copy output" }));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "On branch main\n\tmodified:   file.ts",
      );
    });
  });

  describe("given an error stream", () => {
    it("still renders the output text", () => {
      const { container } = render(
        <TerminalOutput text={"npm ERR! boom"} isError label="npm install" />,
        { wrapper },
      );
      expect(container.textContent).toContain("npm ERR! boom");
      expect(container.textContent).toContain("npm install");
    });
  });
});
