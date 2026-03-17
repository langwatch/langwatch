/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { BetaPill } from "../BetaPill";

afterEach(cleanup);

function renderBetaPill({
  message = <span>Default beta message</span>,
  children = <h1>Feature Title</h1>,
}: {
  message?: React.ReactNode;
  children?: React.ReactNode;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <BetaPill message={message}>{children}</BetaPill>
    </ChakraProvider>,
  );
}

describe("<BetaPill />", () => {
  describe("when the page renders", () => {
    it("displays a Beta pill badge alongside the wrapped content", () => {
      renderBetaPill();

      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.getByText("Feature Title")).toBeInTheDocument();
    });
  });

  describe("when the user hovers over the beta pill", () => {
    it("shows a popover with the custom message content", async () => {
      const user = userEvent.setup();
      renderBetaPill({
        message: <span>This feature is currently in beta</span>,
      });

      await user.hover(screen.getByText("Beta"));

      await waitFor(() => {
        expect(
          screen.getByText("This feature is currently in beta"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when the message contains styled text", () => {
    it("renders the styled text in the popover", async () => {
      const user = userEvent.setup();
      renderBetaPill({
        message: (
          <span>
            This is <strong>bold beta</strong> info
          </span>
        ),
      });

      await user.hover(screen.getByText("Beta"));

      await waitFor(() => {
        expect(screen.getByText("bold beta")).toBeInTheDocument();
        expect(screen.getByText("bold beta").tagName).toBe("STRONG");
      });
    });
  });

  describe("when the message contains a link", () => {
    it("renders the link as clickable inside the popover", async () => {
      const user = userEvent.setup();
      renderBetaPill({
        message: (
          <span>
            Learn more at{" "}
            <a href="https://example.com/beta" target="_blank" rel="noreferrer">
              our docs
            </a>
          </span>
        ),
      });

      await user.hover(screen.getByText("Beta"));

      await waitFor(() => {
        const link = screen.getByRole("link", { name: "our docs" });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute("href", "https://example.com/beta");
      });
    });
  });

  describe("when the user hovers, unhovers, then hovers again", () => {
    it("reopens the popover on the second hover (regression: #2411)", async () => {
      const user = userEvent.setup();
      renderBetaPill({
        message: <span>Hover reopen message</span>,
      });

      const pill = screen.getByText("Beta");

      // First hover — popover opens
      await user.hover(pill);
      await waitFor(() => {
        expect(screen.getByText("Hover reopen message")).toBeVisible();
      });

      // Unhover and wait for close delay (150ms)
      await user.unhover(pill);
      await waitFor(
        () => {
          expect(
            screen.getByText("Hover reopen message"),
          ).not.toBeVisible();
        },
        { timeout: 1000 },
      );

      // Second hover — popover must reopen
      await user.hover(pill);
      await waitFor(() => {
        expect(screen.getByText("Hover reopen message")).toBeVisible();
      });
    });
  });

  describe("when the user focuses the beta pill with the keyboard", () => {
    it("shows the popover with the message content", async () => {
      const user = userEvent.setup();
      renderBetaPill({
        message: <span>Keyboard accessible beta info</span>,
      });

      await user.tab();

      await waitFor(() => {
        expect(
          screen.getByText("Keyboard accessible beta info"),
        ).toBeInTheDocument();
      });
    });
  });
});
