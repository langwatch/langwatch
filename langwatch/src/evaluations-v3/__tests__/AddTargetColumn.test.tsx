/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddTargetColumn } from "../components/AddTargetColumn";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AddTargetColumn", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when no targets exist", () => {
    it("shows Add button with CTA text", () => {
      const onAddClick = vi.fn();
      render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={false}
          isLoading={false}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("button", { name: /^add$/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Click to get started")).toBeInTheDocument();
    });

    it("calls onAddClick when Add button is clicked", async () => {
      const user = userEvent.setup();
      const onAddClick = vi.fn();
      render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={false}
          isLoading={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onAddClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("when targets exist", () => {
    it("shows Add Comparison button", () => {
      const onAddClick = vi.fn();
      render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={true}
          isLoading={false}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("button", { name: /add comparison/i }),
      ).toBeInTheDocument();
    });

    it("does not show CTA text when targets exist", () => {
      const onAddClick = vi.fn();
      render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={true}
          isLoading={false}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByText("Click to get started"),
      ).not.toBeInTheDocument();
    });

    it("calls onAddClick when Add Comparison button is clicked", async () => {
      const user = userEvent.setup();
      const onAddClick = vi.fn();
      render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={true}
          isLoading={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /add comparison/i }));
      expect(onAddClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("when loading", () => {
    it("renders nothing when isLoading is true", () => {
      const onAddClick = vi.fn();
      const { container } = render(
        <AddTargetColumn
          onAddClick={onAddClick}
          hasTargets={false}
          isLoading={true}
        />,
        { wrapper: Wrapper },
      );

      expect(container.firstChild).toBeNull();
    });
  });
});
