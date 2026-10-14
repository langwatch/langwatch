// @vitest-environment jsdom
// Spec: packages/design-system/specs/shortcut-hints.feature
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Kbd } from "../src/components/display/kbd.tsx";
import {
  ShortcutHint,
  shortcutAriaKeys,
  type ShortcutDefinition,
} from "../src/components/display/shortcut-hint.tsx";
import { Tooltip } from "../src/components/overlays/tooltip.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const find: ShortcutDefinition = {
  alternatives: [{ keys: ["Control", "f"] }, { keys: ["Meta", "f"] }],
  scopeLabel: "On the traces page",
};

const nextMatch: ShortcutDefinition = {
  alternatives: [{ keys: ["Enter"] }, { keys: ["ArrowDown"] }],
};

function keycaps(container: HTMLElement): string[] {
  return [...container.querySelectorAll("kbd")].map((node) => node.textContent ?? "");
}

describe("ShortcutHint", () => {
  /** @scenario "A hint shows a chord with plus and alternatives with or" */
  it("shows the platform's modifier for Cmd and Ctrl twins", () => {
    const mac = renderWithDesignSystem(<ShortcutHint shortcut={find} platform="mac" />);
    expect(keycaps(mac.container)).toEqual(["⌘", "F"]);
    mac.unmount();

    const other = renderWithDesignSystem(<ShortcutHint shortcut={find} platform="other" />);
    expect(keycaps(other.container)).toEqual(["Ctrl", "F"]);
    expect(other.container.textContent).toContain("+");
  });

  /** @scenario "A hint shows a chord with plus and alternatives with or" */
  it("joins genuine alternatives with or", () => {
    const view = renderWithDesignSystem(<ShortcutHint shortcut={nextMatch} platform="other" />);
    expect(keycaps(view.container)).toEqual(["Enter", "↓"]);
    expect(view.container.querySelector("[aria-hidden]")?.textContent).toContain("or");
  });

  /** @scenario "A hint is spoken in words and encoded for assistive technology" */
  it("is read as scope then spoken keys, and encodes every chord for ARIA", () => {
    renderWithDesignSystem(<ShortcutHint shortcut={find} platform="other" />);
    expect(screen.getByText("On the traces page: Control plus F")).toBeInTheDocument();
    expect(shortcutAriaKeys(find)).toBe("Control+f Meta+f");
    expect(shortcutAriaKeys(nextMatch)).toBe("Enter ArrowDown");
    expect(shortcutAriaKeys({ alternatives: [{ keys: ["Shift", "Enter"] }] })).toBe("Shift+Enter");
    expect(shortcutAriaKeys({ alternatives: [{ keys: ["?"] }] })).toBe("?");
  });

  /** @scenario "A decorative hint adds nothing to the action's name" */
  it("leaves the action's accessible name alone when decorative", () => {
    renderWithDesignSystem(
      <button type="button">
        Refresh <ShortcutHint shortcut={{ alternatives: [{ keys: ["r"] }] }} decorative />
      </button>,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button").querySelector("[data-shortcut-hint]")).toBeInTheDocument();
  });

  /** @scenario "A hint uses existing neutral tokens in both colour modes" */
  it("renders only keycaps, with no interactive element", () => {
    const view = renderWithDesignSystem(<ShortcutHint shortcut={find} platform="mac" />);
    expect(view.container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});

describe("Kbd", () => {
  /** @scenario "A static key never pulses or listens" */
  it("does not install a keydown listener or pulse when static", () => {
    const add = vi.spyOn(window, "addEventListener");
    const view = renderWithDesignSystem(<Kbd interaction="static">R</Kbd>);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    const before = view.container.querySelector("kbd")?.className;
    fireEvent.keyDown(window, { key: "r" });
    expect(view.container.querySelector("kbd")?.className).toBe(before);
    add.mockRestore();
  });

  /** @scenario "A static key never pulses or listens" */
  it("still listens when live, as before", () => {
    const add = vi.spyOn(window, "addEventListener");
    renderWithDesignSystem(<Kbd>R</Kbd>);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    add.mockRestore();
  });
});

describe("Tooltip shortcut", () => {
  /** @scenario "A tooltip shows its shortcut on hover and focus without new tab stops" */
  it("shows content and hint on focus, keeping one tab stop, click and ref", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    renderWithDesignSystem(
      <Tooltip
        content="Refresh trace"
        shortcut={{ alternatives: [{ keys: ["r"] }] }}
        portalled={false}
        openDelay={0}
      >
        <button ref={ref} type="button" aria-label="Refresh" onClick={onClick}>
          x
        </button>
      </Tooltip>,
    );
    await user.tab();
    expect(ref.current).toHaveFocus();
    expect(await screen.findByText("Refresh trace")).toBeInTheDocument();
    expect(document.querySelector("[role='tooltip'] kbd")?.textContent).toBe("R");
    await user.tab();
    expect(ref.current).not.toHaveFocus();
    ref.current?.focus();
    await user.click(ref.current as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A tooltip without a shortcut is unchanged" */
  it("renders the content alone without a shortcut", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Tooltip content="Plain" portalled={false} openDelay={0}>
        <button type="button">x</button>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByText("Plain")).toBeInTheDocument();
    expect(document.querySelector("[role='tooltip'] kbd")).toBeNull();
  });
});
