/**
 * @vitest-environment jsdom
 *
 * Integration tests for TagPill component.
 *
 * @see specs/features/tag-management.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagPill } from "../TagPill";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<TagPill/>", () => {
  afterEach(cleanup);

  describe("given a label", () => {
    it("displays the label text", () => {
      render(<TagPill label="critical" />, { wrapper: Wrapper });

      expect(screen.getByText("critical")).toBeInTheDocument();
    });
  });

  describe("when onRemove is provided", () => {
    it("displays a remove button", () => {
      render(<TagPill label="billing" onRemove={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByRole("button", { name: "Remove billing tag" }),
      ).toBeInTheDocument();
    });

    it("calls onRemove when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();

      render(<TagPill label="billing" onRemove={onRemove} />, {
        wrapper: Wrapper,
      });

      await user.click(
        screen.getByRole("button", { name: "Remove billing tag" }),
      );
      expect(onRemove).toHaveBeenCalledOnce();
    });
  });

  describe("when onRemove is not provided", () => {
    it("does not display a remove button", () => {
      render(<TagPill label="readonly" />, { wrapper: Wrapper });

      expect(
        screen.queryByRole("button", { name: /Remove/ }),
      ).not.toBeInTheDocument();
    });
  });
});
