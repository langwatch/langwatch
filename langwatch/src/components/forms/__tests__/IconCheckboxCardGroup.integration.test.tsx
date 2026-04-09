/**
 * @vitest-environment jsdom
 *
 * Integration tests for IconCheckboxCardGroup component.
 * Verifies ARIA roles, selection toggling, and keyboard accessibility.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconCheckboxCardGroup } from "../IconCheckboxCardGroup";

const Star = () => <svg data-testid="star-icon" />;
const Heart = () => <svg data-testid="heart-icon" />;
const Bolt = () => <svg data-testid="bolt-icon" />;

const items = [
  { title: "Alpha", value: "alpha" as const, icon: Star },
  { title: "Beta", value: "beta" as const, icon: Heart },
  { title: "Gamma", value: "gamma" as const, icon: Bolt },
];

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<IconCheckboxCardGroup/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered with no selection", () => {
    it("renders a group container with role='group'", () => {
      render(
        <IconCheckboxCardGroup
          items={items}
          value={[]}
          onChange={() => {}}
          ariaLabel="Test group"
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("group", { name: "Test group" }),
      ).toBeInTheDocument();
    });

    it("renders all items as unchecked checkboxes", () => {
      render(
        <IconCheckboxCardGroup
          items={items}
          value={[]}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(3);
      for (const cb of checkboxes) {
        expect(cb).toHaveAttribute("aria-checked", "false");
      }
    });

    it("displays all item titles", () => {
      render(
        <IconCheckboxCardGroup
          items={items}
          value={[]}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });
  });

  describe("when rendered with a label", () => {
    it("uses the label as the group's accessible name", () => {
      render(
        <IconCheckboxCardGroup
          items={items}
          value={[]}
          onChange={() => {}}
          label="Pick interests"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pick interests")).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Pick interests" }),
      ).toBeInTheDocument();
    });
  });

  describe("when items are selected", () => {
    it("marks selected items as checked", () => {
      render(
        <IconCheckboxCardGroup
          items={items}
          value={["alpha", "gamma"]}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
      expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
      expect(checkboxes[2]).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("when a user clicks an unselected item", () => {
    it("calls onChange adding the item", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <IconCheckboxCardGroup
          items={items}
          value={["alpha"]}
          onChange={onChange}
        />,
        { wrapper: Wrapper },
      );

      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[1]!);

      expect(onChange).toHaveBeenCalledWith(["alpha", "beta"]);
    });
  });

  describe("when a user clicks a selected item", () => {
    it("calls onChange removing the item", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <IconCheckboxCardGroup
          items={items}
          value={["alpha", "beta"]}
          onChange={onChange}
        />,
        { wrapper: Wrapper },
      );

      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[0]!);

      expect(onChange).toHaveBeenCalledWith(["beta"]);
    });
  });
});
