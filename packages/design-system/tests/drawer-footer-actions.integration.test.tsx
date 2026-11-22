// @vitest-environment jsdom
/** Secondary outline actions in a drawer footer (ADR-002 decision 2, ruling 2026-10-11). */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionRowProps } from "../src/components/overlays/action-row.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

async function openFooter({ footer, busy }: { footer: ActionRowProps; busy?: boolean }) {
  renderWithDesignSystem(<Drawer onClose={vi.fn()} title="Group" footer={footer} busy={busy} />);
  return within(await screen.findByRole("dialog", { name: "Group" }));
}

const footerNames = () =>
  Array.from(document.querySelectorAll("[data-frame-action]")).map((button) => button.textContent);

describe("a drawer footer with secondary actions", () => {
  /** @scenario "A drawer footer holds several outline actions without a primary" */
  it("draws an array-only footer in order, with no Cancel and no solid primary", async () => {
    const [open, wake, drain] = [vi.fn(), vi.fn(), vi.fn()];
    const callbacks = [open, wake, drain];
    const drawer = await openFooter({
      footer: {
        secondaryActions: [
          { label: "Open", onClick: open },
          { label: "Wake now", tone: "info", onClick: wake },
          { label: "Drain", tone: "danger", onClick: drain },
        ],
      },
    });

    expect(footerNames()).toEqual(["Open", "Wake now", "Drain"]);
    expect(drawer.queryByRole("button", { name: "Cancel" })).toBeNull();
    for (const label of ["Open", "Wake now", "Drain"]) {
      const button = drawer.getByRole("button", { name: label });
      expect(button.getAttribute("data-frame-action")).toBe("secondary");
    }
    const user = userEvent.setup();
    for (const [index, label] of ["Open", "Wake now", "Drain"].entries()) {
      await user.click(drawer.getByRole("button", { name: label }));
      callbacks.forEach((callback, at) =>
        expect(callback).toHaveBeenCalledTimes(at <= index ? 1 : 0),
      );
    }
  });

  /** @scenario "A drawer footer holds several outline actions without a primary" */
  it("draws the singular secondary first, then the array, then the primary", async () => {
    await openFooter({
      footer: {
        primaryAction: { label: "Save", onClick: vi.fn() },
        secondaryActions: [{ label: "Second", onClick: vi.fn() }],
        secondaryAction: { label: "First", onClick: vi.fn() },
      },
    });

    expect(footerNames()).toEqual(["First", "Second", "Save"]);
  });

  /** @scenario "A drawer footer holds several outline actions without a primary" */
  it("keeps a singular-only and an empty-array footer as they were", async () => {
    const drawer = await openFooter({
      footer: { secondaryAction: { label: "Only", onClick: vi.fn() }, secondaryActions: [] },
    });

    expect(drawer.getAllByRole("button", { name: "Only" })).toHaveLength(1);
  });

  /** @scenario "A drawer footer holds several outline actions without a primary" */
  it("blocks loading, busy and drawer-busy actions, and keeps loading names and reasons", async () => {
    const onClick = vi.fn();
    const drawer = await openFooter({
      busy: true,
      footer: {
        secondaryActions: [
          { label: "Retry now", loading: true, onClick },
          { label: "Drain", tone: "danger", onClick, disabledReason: "Only admins can drain" },
        ],
      },
    });

    const user = userEvent.setup();
    await user.click(drawer.getByRole("button", { name: "Retry now" }));
    await user.click(drawer.getByRole("button", { name: "Drain" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(drawer.getByLabelText("Only admins can drain")).toBeTruthy();
  });

  /** @scenario "A drawer footer holds several outline actions without a primary" */
  it("runs a menu item and a submit target through the shared renderer", async () => {
    const onSelect = vi.fn();
    const drawer = await openFooter({
      footer: {
        secondaryActions: [
          { label: "More", items: [{ value: "a", label: "Item A", onSelect }] },
          { label: "Apply", type: "submit", form: "other-form", tone: "success" },
        ],
      },
    });

    expect(drawer.getByRole("button", { name: "Apply" }).getAttribute("form")).toBe("other-form");
    const user = userEvent.setup();
    await user.click(drawer.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Item A" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
