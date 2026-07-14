/**
 * @vitest-environment jsdom
 *
 * Integration tests for TagList component.
 *
 * @see specs/features/tag-management.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagList } from "../TagList";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<TagList/>", () => {
  afterEach(cleanup);

  describe("given a list of labels", () => {
    it("displays all labels as tag pills", () => {
      render(<TagList labels={["nightly", "regression"]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("nightly")).toBeInTheDocument();
      expect(screen.getByText("regression")).toBeInTheDocument();
    });
  });

  describe("when onAdd is provided", () => {
    it("displays a + add button", () => {
      render(
        <TagList labels={["ci"]} onAdd={vi.fn()} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("+ add")).toBeInTheDocument();
    });

    it("shows an inline text input when + add is clicked", async () => {
      const user = userEvent.setup();

      render(
        <TagList labels={["ci"]} onAdd={vi.fn()} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+ add"));
      expect(screen.getByPlaceholderText("Add label...")).toBeInTheDocument();
    });

    it("calls onAdd when Enter is pressed in the input", async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();

      render(
        <TagList labels={[]} onAdd={onAdd} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+ add"));
      const input = screen.getByPlaceholderText("Add label...");
      await user.type(input, "new-tag{enter}");
      expect(onAdd).toHaveBeenCalledWith("new-tag");
    });

    it("does not call onAdd when typing a duplicate label", async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();

      render(
        <TagList labels={["existing"]} onAdd={onAdd} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+ add"));
      const input = screen.getByPlaceholderText("Add label...");
      await user.type(input, "existing{enter}");
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("keeps the input open after pressing Enter for rapid entry", async () => {
      const user = userEvent.setup();

      render(
        <TagList labels={[]} onAdd={vi.fn()} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+ add"));
      const input = screen.getByPlaceholderText("Add label...");
      await user.type(input, "new-tag{enter}");
      expect(
        screen.getByPlaceholderText("Add label..."),
      ).toBeInTheDocument();
    });

    it("hides the input on Escape", async () => {
      const user = userEvent.setup();

      render(
        <TagList labels={[]} onAdd={vi.fn()} onRemove={vi.fn()} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+ add"));
      screen.getByPlaceholderText("Add label...");
      await user.keyboard("{Escape}");
      expect(
        screen.queryByPlaceholderText("Add label..."),
      ).not.toBeInTheDocument();
    });
  });

  describe("when onAdd is not provided", () => {
    it("does not display a + add button", () => {
      render(<TagList labels={["ci"]} />, { wrapper: Wrapper });

      expect(screen.queryByText("+ add")).not.toBeInTheDocument();
    });
  });

  describe("when onRemove is provided", () => {
    it("displays remove buttons on each tag", () => {
      render(
        <TagList
          labels={["alpha", "beta"]}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("button", { name: "Remove alpha tag" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove beta tag" }),
      ).toBeInTheDocument();
    });

    it("calls onRemove with the label when remove is clicked", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();

      render(
        <TagList labels={["alpha", "beta"]} onRemove={onRemove} />,
        { wrapper: Wrapper },
      );

      await user.click(
        screen.getByRole("button", { name: "Remove alpha tag" }),
      );
      expect(onRemove).toHaveBeenCalledWith("alpha", 0);
    });
  });

  describe("given an empty labels array", () => {
    it("renders nothing when no onAdd is provided", () => {
      const { container } = render(<TagList labels={[]} />, {
        wrapper: Wrapper,
      });

      expect(container.textContent).toBe("");
    });
  });
});
