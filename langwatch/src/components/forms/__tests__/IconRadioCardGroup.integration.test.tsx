/**
 * @vitest-environment jsdom
 *
 * Integration tests for IconRadioCardGroup component.
 * Verifies ARIA roles, selection, and keyboard navigation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconRadioCardGroup } from "../IconRadioCardGroup";

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

describe("<IconRadioCardGroup/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered with no selection", () => {
    it("renders a radiogroup container", () => {
      render(
        <IconRadioCardGroup
          items={items}
          onChange={() => {}}
          ariaLabel="Test radio group"
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("radiogroup", { name: "Test radio group" }),
      ).toBeInTheDocument();
    });

    it("renders all items as unchecked radios", () => {
      render(
        <IconRadioCardGroup
          items={items}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(3);
      for (const radio of radios) {
        expect(radio).toHaveAttribute("aria-checked", "false");
      }
    });

    it("makes only the first item tabbable", () => {
      render(
        <IconRadioCardGroup
          items={items}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const radios = screen.getAllByRole("radio");
      expect(radios[0]).toHaveAttribute("tabindex", "0");
      expect(radios[1]).toHaveAttribute("tabindex", "-1");
      expect(radios[2]).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("when an item is selected", () => {
    it("marks the selected item as checked", () => {
      render(
        <IconRadioCardGroup
          items={items}
          value="beta"
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const radios = screen.getAllByRole("radio");
      expect(radios[0]).toHaveAttribute("aria-checked", "false");
      expect(radios[1]).toHaveAttribute("aria-checked", "true");
      expect(radios[2]).toHaveAttribute("aria-checked", "false");
    });

    it("makes the selected item tabbable", () => {
      render(
        <IconRadioCardGroup
          items={items}
          value="beta"
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      const radios = screen.getAllByRole("radio");
      expect(radios[0]).toHaveAttribute("tabindex", "-1");
      expect(radios[1]).toHaveAttribute("tabindex", "0");
      expect(radios[2]).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("when a user clicks a radio", () => {
    it("calls onChange with the clicked value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <IconRadioCardGroup
          items={items}
          value="alpha"
          onChange={onChange}
        />,
        { wrapper: Wrapper },
      );

      const radios = screen.getAllByRole("radio");
      await user.click(radios[2]!);

      expect(onChange).toHaveBeenCalledWith("gamma");
    });
  });

  describe("when rendered vertically", () => {
    it("renders a radiogroup container", () => {
      render(
        <IconRadioCardGroup
          items={items}
          onChange={() => {}}
          direction="vertical"
          ariaLabel="Vertical group"
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("radiogroup", { name: "Vertical group" }),
      ).toBeInTheDocument();
    });

    it("renders all radio items", () => {
      render(
        <IconRadioCardGroup
          items={items}
          onChange={() => {}}
          direction="vertical"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });
  });

  describe("when items have no icons", () => {
    it("renders items without icons", () => {
      const noIconItems = [
        { title: "One", value: "one" as const },
        { title: "Two", value: "two" as const },
      ];

      render(
        <IconRadioCardGroup
          items={noIconItems}
          onChange={() => {}}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("One")).toBeInTheDocument();
      expect(screen.getByText("Two")).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });
  });
});
