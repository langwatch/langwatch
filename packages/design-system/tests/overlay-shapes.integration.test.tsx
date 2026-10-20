// @vitest-environment jsdom
/** The drawer and dialog shapes (ADR-002): slots, close requests, forms, states, portals, focus. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Select } from "../src/components/forms/select.tsx";
import type { ActionRowProps } from "../src/components/overlays/action-row.tsx";
import { ConfirmDialog } from "../src/components/overlays/confirm-dialog.tsx";
import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer, setDrawerEndInset } from "../src/components/overlays/drawer.tsx";
import { Menu } from "../src/components/overlays/menu.tsx";
import { createListCollection } from "../src/primitives.ts";
import { DesignSystemProvider } from "../src/provider/index.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function parentOf(element: Element): Element {
  const parent = element.parentElement;
  if (!parent) throw new Error("expected the element to have a parent");
  return parent;
}

/** jsdom resolves no cascade layers, so read the rules a node's classes were given. */
function rulesOf(element: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  return Array.from(element.classList)
    .flatMap((name) => css.match(new RegExp(`\\.${name}\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

function found(element: Element | null): Element {
  if (!element) throw new Error("expected the element to be in the document");
  return element;
}

function Crash(): never {
  throw new Error("boom: secret internals");
}

/** jsdom lays nothing out, so the focus trap would treat every element as hidden. */
function stubLayout() {
  const rect = new DOMRect(0, 0, 10, 10);
  const rects: DOMRectList = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  };
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(rects);
}

describe("the Drawer shape", () => {
  describe("given every header slot and a footer primary", () => {
    /** @scenario "A drawer draws its slots and a footer without Cancel" */
    it("is named by its title, described by its subtitle, and has no Cancel", async () => {
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="Production key"
          eyebrow={{ label: "Virtual key" }}
          subtitle="Routes to OpenAI"
          badges={<span>Active</span>}
          footer={{ primaryAction: { label: "Save", onClick: vi.fn() } }}
        >
          Body text
        </Drawer>,
      );

      const drawer = await screen.findByRole("dialog", { name: "Production key" });
      expect(within(drawer).getByText("Virtual key")).toBeTruthy();
      const describedBy = drawer.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent).toBe("Routes to OpenAI");
      expect(within(drawer).getByRole("button", { name: "Save" })).toBeTruthy();
      expect(within(drawer).queryByRole("button", { name: "Cancel" })).toBeNull();
    });
  });

  describe("when the reader asks to close", () => {
    /** @scenario "Closing an overlay is a request the caller answers" */
    it("calls onClose from the X and Escape and stays open until the caller closes it", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(<Drawer onClose={onClose} title="Budget" data-testid="budget" />);

      await user.click(await screen.findByTestId("budget-close"));
      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("dialog", { name: "Budget" })).toBeTruthy();
    });

    /** @scenario "Closing an overlay is a request the caller answers" */
    it("holds the X and Escape while a save is in flight", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(<Drawer onClose={onClose} title="Budget" data-testid="budget" busy />);

      const close = await screen.findByTestId("budget-close");
      expect(close.hasAttribute("disabled")).toBe(true);
      await user.click(screen.getByText("Budget"));
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("given the drawer owns its form", () => {
    /** @scenario "A footer submit action submits the right form once" */
    it("submits once from the submit action and once from Enter", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="New budget"
          onSubmit={onSubmit}
          footer={{ primaryAction: { label: "Create budget", type: "submit" } }}
        >
          <input aria-label="Name" />
        </Drawer>,
      );

      await user.click(await screen.findByRole("button", { name: "Create budget" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await user.type(screen.getByRole("textbox", { name: "Name" }), "{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A footer submit action submits the right form once" */
    it("submits a child-owned form named by id, and nothing else", async () => {
      const childSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="Invite members"
          footer={{ primaryAction: { label: "Send invites", type: "submit", form: "invite" } }}
        >
          <form id="invite" onSubmit={childSubmit}>
            <input aria-label="Email" />
          </form>
        </Drawer>,
      );

      const send = await screen.findByRole("button", { name: "Send invites" });
      expect(send.getAttribute("form")).toBe("invite");
      expect(send.getAttribute("type")).toBe("submit");
      const others = screen.getAllByRole("button").filter((button) => button !== send);
      expect(others.every((button) => button.getAttribute("type") === "button")).toBe(true);
      await userEvent.setup().click(send);
      expect(childSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a read that is loading or has failed", () => {
    /** @scenario "An overlay body shows loading and failure in place of its content" */
    it("shows skeleton rows while loading", async () => {
      renderWithDesignSystem(
        <Drawer onClose={vi.fn()} title="Trace" loading>
          Real body
        </Drawer>,
      );

      await screen.findByRole("dialog");
      expect(screen.queryByText("Real body")).toBeNull();
      expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    });

    /** @scenario "An overlay body shows loading and failure in place of its content" */
    it("shows an error banner whose retry runs", async () => {
      const onRetry = vi.fn();
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="Trace"
          error={{ title: "Couldn't load the trace", onRetry }}
        >
          Real body
        </Drawer>,
      );

      expect(await screen.findByText("Couldn't load the trace")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("when its content crashes while rendering", () => {
    /** @scenario "A render crash keeps the overlay open and named" */
    it("stays open, named, with its close button and an inline error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="Prompt editor"
          data-testid="editor"
          titleContent={<Crash />}
        />,
      );

      expect(await screen.findByRole("dialog", { name: "Prompt editor" })).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain("Prompt editor");
      expect(screen.getByRole("alert").textContent).not.toContain("secret internals");
      expect(screen.getByTestId("editor-close")).toBeTruthy();
    });
  });
});

describe("the Dialog shape", () => {
  describe("given a primary action", () => {
    /** @scenario "A dialog keeps Cancel unless a second choice takes its place" */
    it("shows Cancel beside it, and Cancel requests a close", async () => {
      const onClose = vi.fn();
      renderWithDesignSystem(
        <Dialog
          open
          onClose={onClose}
          title="Copy dataset"
          primaryAction={{ label: "Copy", onClick: vi.fn() }}
        />,
      );

      await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A dialog keeps Cancel unless a second choice takes its place" */
    it("lets a secondary action take Cancel's place", async () => {
      renderWithDesignSystem(
        <Dialog
          open
          onClose={vi.fn()}
          title="Revoke shared links?"
          primaryAction={{ label: "Revoke 3 links", onClick: vi.fn(), danger: true }}
          secondaryAction={{ label: "Keep links paused", onClick: vi.fn() }}
        />,
      );

      expect(await screen.findByRole("button", { name: "Keep links paused" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });
  });

  describe("given it is not dismissible", () => {
    /** @scenario "A dialog that must be acknowledged cannot be dismissed" */
    it("has no X, no Cancel, and ignores Escape", async () => {
      const onClose = vi.fn();
      renderWithDesignSystem(
        <Dialog
          open
          onClose={onClose}
          title="Save your key"
          role="alertdialog"
          dismissible={false}
          primaryAction={{ label: "Done", onClick: vi.fn() }}
        />,
      );

      const dialog = await screen.findByRole("alertdialog", { name: "Save your key" });
      expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
      await userEvent.setup().keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when a select and a nested menu open inside it", () => {
    /** @scenario "Popups opened inside an overlay portal into it" */
    it("renders their options inside the dialog", async () => {
      const models = createListCollection({ items: [{ label: "gpt-5", value: "gpt-5" }] });
      renderWithDesignSystem(
        <Dialog open onClose={vi.fn()} title="Optimize">
          <Select.Root collection={models}>
            <Select.Trigger aria-label="Model">
              <Select.ValueText placeholder="Pick a model" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item item={models.items[0]}>gpt-5</Select.Item>
            </Select.Content>
          </Select.Root>
          <Menu.Root>
            <Menu.Trigger>More</Menu.Trigger>
            <Menu.Content>
              <Menu.Root positioning={{ placement: "right-start" }}>
                <Menu.TriggerItem value="export">Export</Menu.TriggerItem>
                <Menu.Content>
                  <Menu.Item value="csv">As CSV</Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </Menu.Content>
          </Menu.Root>
        </Dialog>,
      );

      const user = userEvent.setup();
      const dialog = await screen.findByRole("dialog", { name: "Optimize" });
      await user.click(within(dialog).getByRole("combobox", { name: "Model" }));
      await waitFor(() =>
        expect(within(dialog).getByRole("option", { name: "gpt-5" })).toBeTruthy(),
      );
      await user.keyboard("{Escape}");
      await user.click(within(dialog).getByRole("button", { name: "More" }));
      await user.click(await within(dialog).findByRole("menuitem", { name: "Export" }));
      expect(await within(dialog).findByRole("menuitem", { name: "As CSV" })).toBeTruthy();
    });
  });

  describe("given an initial focus request", () => {
    beforeEach(stubLayout);
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** @scenario "A dialog focuses the requested action first" */
    it("focuses the primary action", async () => {
      renderWithDesignSystem(
        <Dialog
          open
          onClose={vi.fn()}
          title="Leave LangWatch?"
          initialFocus="primary"
          primaryAction={{ label: "Stay here", onClick: vi.fn() }}
        >
          <input aria-label="Note" />
        </Dialog>,
      );

      const stay = await screen.findByRole("button", { name: "Stay here" });
      await waitFor(() => expect(document.activeElement).toBe(stay));
    });

    /** @scenario "A dialog focuses the requested action first" */
    it("focuses the first field without a request", async () => {
      renderWithDesignSystem(
        <Dialog
          open
          onClose={vi.fn()}
          title="Rename"
          primaryAction={{ label: "Save", onClick: vi.fn() }}
        >
          <input aria-label="Name" />
        </Dialog>,
      );

      const field = await screen.findByRole("textbox", { name: "Name" });
      await waitFor(() => expect(document.activeElement).toBe(field));
    });
  });
});

describe("the design system provider", () => {
  describe("given a development build", () => {
    /** @scenario "The shell tells overlay error fallbacks it is a development build" */
    it("shows the raw crash text in an overlay's inline error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      render(
        <DesignSystemProvider isDevelopment forcedTheme="light">
          <Dialog open onClose={vi.fn()} title="Optimize">
            <Crash />
          </Dialog>
        </DesignSystemProvider>,
      );

      expect((await screen.findByRole("alert")).textContent).toContain("secret internals");
    });
  });
});

describe("ConfirmDialog", () => {
  describe("given the deprecated onOpenChange and message", () => {
    /** @scenario "The confirmation dialog keeps its old props while callers move" */
    it("shows the message and requests onOpenChange(false) from Cancel", async () => {
      const onOpenChange = vi.fn<(open: boolean) => void>();
      renderWithDesignSystem(
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          title="Revoke API key?"
          message="Callers stop working at once."
          onConfirm={vi.fn()}
        />,
      );

      expect(await screen.findByText("Callers stop working at once.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe("a busy overlay", () => {
  describe("given a save is in flight", () => {
    /** @scenario "A busy overlay runs no action" */
    it("ignores Enter in a field of its own form", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(
        <Drawer onClose={vi.fn()} title="New budget" onSubmit={onSubmit} busy>
          <input aria-label="Name" />
        </Drawer>,
      );

      await user.type(await screen.findByRole("textbox", { name: "Name" }), "{Enter}");

      expect(onSubmit).not.toHaveBeenCalled();
    });

    /** @scenario "A busy overlay runs no action" */
    it("ignores Enter in a field of a busy dialog's form", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(
        <Dialog open onClose={vi.fn()} title="Copy dataset" onSubmit={onSubmit} busy>
          <input aria-label="Name" />
        </Dialog>,
      );

      await user.type(await screen.findByRole("textbox", { name: "Name" }), "{Enter}");

      expect(onSubmit).not.toHaveBeenCalled();
    });

    /** @scenario "A busy overlay runs no action" */
    it("does not run a menu item chosen from a menu that was already open", async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      const footer = (busy: boolean) => (
        <Drawer
          onClose={vi.fn()}
          title="Export"
          busy={busy}
          footer={{
            secondaryAction: {
              label: "Export as",
              items: [{ value: "csv", label: "CSV", onSelect }],
            },
          }}
        />
      );
      const { rerender } = renderWithDesignSystem(footer(false));
      await user.click(await screen.findByRole("button", { name: "Export as" }));
      const item = await screen.findByRole("menuitem", { name: "CSV" });

      rerender(footer(true));
      await user.click(item);

      expect(onSelect).not.toHaveBeenCalled();
    });

    /** @scenario "A busy overlay runs no action" */
    it("keeps Escape and an outside click from closing a busy dialog", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderWithDesignSystem(<Dialog open onClose={onClose} title="Saving" busy />);

      await screen.findByRole("dialog", { name: "Saving" });
      await user.keyboard("{Escape}");
      fireEvent.pointerDown(document.body);
      fireEvent.pointerUp(document.body);

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

describe("a drawer footer", () => {
  /** @scenario "A drawer footer draws Cancel only when it is given one" */
  it("draws no Cancel until the descriptor carries one", async () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="Edit key"
        footer={{ primaryAction: { label: "Save", onClick: vi.fn() } }}
      />,
    );

    const drawer = await screen.findByRole("dialog", { name: "Edit key" });
    expect(within(drawer).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  /** @scenario "A drawer footer draws Cancel only when it is given one" */
  it("draws the Cancel a shared descriptor carries, once, before the primary action", async () => {
    const onCancel = vi.fn();
    const shared: ActionRowProps = {
      primaryAction: { label: "Save", onClick: vi.fn() },
      cancel: { label: "Discard", onClick: onCancel, "data-testid": "discard-button" },
    };
    renderWithDesignSystem(<Drawer onClose={vi.fn()} title="Edit key" footer={shared} />);

    const drawer = await screen.findByRole("dialog", { name: "Edit key" });
    const buttons = within(drawer)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons.filter((name) => name === "Discard")).toHaveLength(1);
    expect(buttons.indexOf("Discard")).toBeLessThan(buttons.indexOf("Save"));
    const discard = within(drawer).getByRole("button", { name: "Discard" });
    expect(discard.getAttribute("data-testid")).toBe("discard-button");
    await userEvent.setup().click(discard);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A drawer footer draws Cancel only when it is given one" */
  it("waits on Cancel while a save is in flight", async () => {
    const onCancel = vi.fn();
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="Edit key"
        busy
        footer={{
          cancel: { onClick: onCancel },
          primaryAction: { label: "Save", onClick: vi.fn() },
        }}
      />,
    );

    const drawer = await screen.findByRole("dialog", { name: "Edit key" });
    expect(within(drawer).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  /** @scenario "A drawer footer draws Cancel only when it is given one" */
  it("keeps a Cancel with its own side effect separate from the close request", async () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    renderWithDesignSystem(
      <Drawer onClose={onClose} title="Edit key" footer={{ cancel: { onClick: onDiscard } }} />,
    );

    const drawer = await screen.findByRole("dialog", { name: "Edit key" });
    await userEvent.setup().click(within(drawer).getByRole("button", { name: "Cancel" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a drawer's action hooks", () => {
  /** @scenario "Existing back and cancel hooks identify the actual action buttons" */
  it("puts the given ids on the real Back and Cancel buttons, each running only its own callback", async () => {
    const onBack = vi.fn();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderWithDesignSystem(
      <Drawer
        onClose={onClose}
        onBack={onBack}
        backButtonTestId="back-button"
        title="Connect from code"
        data-testid="connect"
        footer={{ cancel: { onClick: onCancel, "data-testid": "widget-cancel" } }}
      />,
    );

    const drawer = await screen.findByRole("dialog", { name: "Connect from code" });
    const back = within(drawer).getByRole("button", { name: "Back" });
    const cancel = within(drawer).getByRole("button", { name: "Cancel" });
    expect(back).toBe(screen.getByTestId("back-button"));
    expect(cancel).toBe(screen.getByTestId("widget-cancel"));
    expect(screen.queryByTestId("connect-back")).toBeNull();
    const user = userEvent.setup();
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  /** @scenario "Existing back and cancel hooks identify the actual action buttons" */
  it("falls back to the drawer's id and the suffix back, and to no id without either", async () => {
    renderWithDesignSystem(
      <Drawer onClose={vi.fn()} onBack={vi.fn()} title="Prefixed" data-testid="prefixed" />,
    );
    const prefixed = await screen.findByRole("dialog", { name: "Prefixed" });
    expect(within(prefixed).getByRole("button", { name: "Back" })).toBe(
      screen.getByTestId("prefixed-back"),
    );
    cleanup();

    renderWithDesignSystem(<Drawer onClose={vi.fn()} onBack={vi.fn()} title="Anonymous" />);
    const anonymous = await screen.findByRole("dialog", { name: "Anonymous" });
    expect(
      within(anonymous).getByRole("button", { name: "Back" }).hasAttribute("data-testid"),
    ).toBe(false);
  });

  /** @scenario "Existing back and cancel hooks identify the actual action buttons" */
  it("waits on Back and Cancel while a save is in flight", async () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        onBack={vi.fn()}
        busy
        title="Saving"
        backButtonTestId="back-button"
        footer={{ cancel: { onClick: vi.fn(), "data-testid": "widget-cancel" } }}
      />,
    );

    await screen.findByRole("dialog", { name: "Saving" });
    expect(screen.getByTestId("back-button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("widget-cancel").hasAttribute("disabled")).toBe(true);
  });
});

describe("a drawer's icon", () => {
  /** @scenario "A drawer title keeps its 24px source icon visible" */
  it("is decorative: the drawer is named by its title alone", async () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="GitHub source"
        icon={<svg width="24" height="24" data-testid="glyph" />}
      />,
    );

    const drawer = await screen.findByRole("dialog", { name: "GitHub source" });
    const glyph = within(drawer).getByTestId("glyph");
    expect(glyph.closest("[aria-hidden='true']")).toBeTruthy();
    expect(glyph.getAttribute("width")).toBe("24");
    expect(within(drawer).getByRole("heading", { name: "GitHub source" })).toBeTruthy();
  });

  /** @scenario "A drawer title keeps its 24px source icon visible" */
  it("draws the header it had when there is no icon", async () => {
    renderWithDesignSystem(<Drawer onClose={vi.fn()} title="Plain" />);

    const drawer = await screen.findByRole("dialog", { name: "Plain" });
    const heading = within(drawer).getByRole("heading", { name: "Plain" });
    expect(parentOf(heading).querySelector("[aria-hidden='true']")).toBeNull();
  });
});

describe("a dialog without a Cancel button", () => {
  /** @scenario "A dialog finished by one action can drop Cancel and stay dismissible" */
  it("shows only the primary action, and the X and Escape each request one close", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={onClose}
        title="Token created"
        cancelLabel={null}
        primaryAction={{ label: "Done", onClick: vi.fn() }}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    expect(dialog.querySelector('[data-frame-action="cancel"]')).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A dialog finished by one action can drop Cancel and stay dismissible" */
  it("keeps the X on a dialog with neither a primary action nor a Cancel", async () => {
    renderWithDesignSystem(<Dialog open onClose={vi.fn()} title="Notice" cancelLabel={null} />);

    const dialog = await screen.findByRole("dialog", { name: "Notice" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(dialog.querySelector("[data-frame-action]")).toBeNull();
  });
});

describe("a dialog that ignores an outside click", () => {
  /** @scenario "A secret dialog ignores an outside click but closes by X or Escape" */
  it("stays open on an outside click, then closes once by the X and once by Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={onClose}
        title="Your new token"
        closeOnInteractOutside={false}
        primaryAction={{ label: "Done", onClick: vi.fn() }}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Your new token" });
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A secret dialog ignores an outside click but closes by X or Escape" */
  it("keeps a non-dismissible dialog open on an outside click whatever the flag says", async () => {
    const onClose = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={onClose}
        title="Must acknowledge"
        dismissible={false}
        closeOnInteractOutside
        primaryAction={{ label: "Done", onClick: vi.fn() }}
      />,
    );

    await screen.findByRole("dialog", { name: "Must acknowledge" });
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a drawer on a narrow screen", () => {
  /** @scenario "A drawer header and footer give way on a narrow screen" */
  it("lets the header row wrap its tools and keeps the footer actions wrapping", async () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="Production key"
        headerTools={<button type="button">Version v12 (latest published)</button>}
        footer={{
          cancel: { onClick: vi.fn() },
          secondaryAction: { label: "Save as draft", onClick: vi.fn() },
          primaryAction: { label: "Publish to production", onClick: vi.fn() },
        }}
        data-testid="narrow"
      />,
    );

    const drawer = await screen.findByTestId("narrow");
    const title = within(drawer).getByRole("heading", { name: "Production key" });
    expect(getComputedStyle(parentOf(parentOf(title))).flexWrap).toBe("wrap");
    expect(getComputedStyle(found(drawer.querySelector("[data-action-row]"))).flexWrap).toBe(
      "wrap",
    );
  });
});

describe("a drawer beside a docked panel", () => {
  /** @scenario "A drawer yields a docked panel's room and clears the home indicator" */
  it("yields the docked panel's room and keeps its footer above the home indicator", async () => {
    setDrawerEndInset(320);
    try {
      renderWithDesignSystem(
        <Drawer
          onClose={vi.fn()}
          title="Production key"
          size="lg"
          footer={{ primaryAction: { label: "Save", onClick: vi.fn() } }}
          data-testid="docked"
        />,
      );

      const drawer = await screen.findByTestId("docked");
      expect(rulesOf(drawer)).toContain("calc(100vw - 1rem - 320px)");
      const save = within(drawer).getByRole("button", { name: "Save" });
      const footer = found(save.closest(".chakra-drawer__footer"));
      expect(rulesOf(footer)).toContain("env(safe-area-inset-bottom");
    } finally {
      setDrawerEndInset(0);
    }
  });
});

describe("a dialog's placement", () => {
  /** @scenario "A dialog can stand centred and keeps its size" */
  it("centres the frame on request and otherwise leaves the recipe's own place", async () => {
    const { rerender } = renderWithDesignSystem(
      <Dialog open onClose={vi.fn()} title="Rename" size="lg" placement="center" />,
    );
    const centred = await screen.findByRole("dialog", { name: "Rename" });
    expect(centred.dataset.size).toBe("lg");
    expect(rulesOf(parentOf(centred))).toContain("align-items:center");

    rerender(<Dialog open onClose={vi.fn()} title="Rename" size="lg" />);
    const top = await screen.findByRole("dialog", { name: "Rename" });
    expect(top.dataset.size).toBe("lg");
    expect(rulesOf(parentOf(top))).not.toContain("align-items:center");
  });
});

describe("when an overlay's content crashes", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "A crashed overlay keeps a named shell and a working close control" */
  it("keeps a close control that works when a legacy drawer body crashes", async () => {
    const onOpenChange = vi.fn();
    renderWithDesignSystem(
      <Drawer.Root open onOpenChange={onOpenChange}>
        <Drawer.Content errorScope="Edit agent">
          <Drawer.Header>
            <Drawer.Title>Edit agent</Drawer.Title>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body>
            <Crash />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("Edit agent");
    expect(screen.getByRole("dialog", { name: "Edit agent" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(expect.objectContaining({ open: false }));
  });

  /** @scenario "A crashed overlay keeps a named shell and a working close control" */
  it("keeps the dialog named with an X that closes it when its body crashes", async () => {
    const onClose = vi.fn();
    renderWithDesignSystem(
      <Dialog open onClose={onClose} title="Copy dataset" data-testid="copy">
        <Crash />
      </Dialog>,
    );

    expect(await screen.findByRole("dialog", { name: "Copy dataset" })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId("copy-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A crashed overlay keeps a named shell and a working close control" */
  it("keeps a must-acknowledge dialog's own action reachable after its body crashes", async () => {
    const onDone = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Save your key"
        role="alertdialog"
        dismissible={false}
        primaryAction={{ label: "Done", onClick: onDone }}
      >
        <Crash />
      </Dialog>,
    );

    const dialog = await screen.findByRole("alertdialog", { name: "Save your key" });
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A crashed overlay recovers when the entity it shows changes" */
  it("recovers when another entity with the same title replaces the one that crashed", async () => {
    function Agent({ id }: { id: string }) {
      if (id === "a1") throw new Error("boom: agent one");
      return <p>Agent two body</p>;
    }
    const show = (id: string) => (
      <Drawer onClose={vi.fn()} title="Edit agent" entityKey={id}>
        <Agent id={id} />
      </Drawer>
    );
    const { rerender } = renderWithDesignSystem(show("a1"));
    expect(await screen.findByRole("alert")).toBeTruthy();

    rerender(show("a2"));

    expect(await screen.findByText("Agent two body")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a dialog's initial focus", () => {
  beforeEach(stubLayout);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "A dialog's initial focus skips what cannot take it" */
  it("skips a disabled first field and a hidden one for the first usable field", async () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Rename"
        primaryAction={{ label: "Save", onClick: vi.fn() }}
      >
        <input aria-label="Locked" disabled />
        <input aria-label="Token" type="hidden" />
        <fieldset disabled>
          <input aria-label="Frozen" />
        </fieldset>
        <div hidden>
          <input aria-label="Tucked away" />
        </div>
        <input aria-label="Name" />
      </Dialog>,
    );

    const field = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  /** @scenario "A dialog's initial focus skips what cannot take it" */
  it("falls back to Cancel when a requested action is disabled and there are no fields", async () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Leave LangWatch?"
        initialFocus="primary"
        primaryAction={{ label: "Stay here", onClick: vi.fn(), disabledReason: "Checking" }}
      />,
    );

    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  /** @scenario "A dialog's initial focus skips what cannot take it" */
  it("returns focus to the control that opened it", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open rename
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Rename">
            <input aria-label="Name" />
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    renderWithDesignSystem(<Opener />);
    const opener = screen.getByRole("button", { name: "Open rename" });

    await user.click(opener);
    const field = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("the retained Content parts", () => {
  /** @scenario "The retained Content parts still accept asChild" */
  it("renders a Drawer.Content asChild as the caller's element", async () => {
    renderWithDesignSystem(
      <Drawer.Root open>
        <Drawer.Content asChild>
          <section data-testid="custom">
            <Drawer.Title>Custom drawer</Drawer.Title>
          </section>
        </Drawer.Content>
      </Drawer.Root>,
    );

    const custom = await screen.findByTestId("custom");
    expect(custom.tagName).toBe("SECTION");
    expect(custom.getAttribute("role")).toBe("dialog");
    expect(within(custom).getByText("Custom drawer")).toBeTruthy();
  });

  /** @scenario "The retained Content parts still accept asChild" */
  it("renders a Dialog.Content asChild as the caller's element", async () => {
    renderWithDesignSystem(
      <Dialog.Root open>
        <Dialog.Content asChild>
          <section data-testid="custom">
            <Dialog.Title>Custom dialog</Dialog.Title>
          </section>
        </Dialog.Content>
      </Dialog.Root>,
    );

    const custom = await screen.findByTestId("custom");
    expect(custom.tagName).toBe("SECTION");
    expect(custom.getAttribute("role")).toBe("dialog");
    expect(within(custom).getByText("Custom dialog")).toBeTruthy();
  });
});

describe("a routed drawer opened from a modal dialog", () => {
  beforeEach(stubLayout);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function DatasetFlow() {
    const [drawer, setDrawer] = useState(false);
    return (
      <>
        <Dialog open onClose={vi.fn()} title="Pick a dataset">
          <button type="button" onClick={() => setDrawer(true)}>
            Upload CSV
          </button>
          <button type="button">Browse datasets</button>
        </Dialog>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Upload CSV" data-testid="up">
          <input aria-label="File name" />
        </Drawer>
      </>
    );
  }

  /** @scenario "A routed drawer opened from a modal dialog takes focus and gives it back" */
  it("takes focus, keeps it while the reader types and tabs, and returns it on close", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<DatasetFlow />);
    const upload = await screen.findByRole("button", { name: "Upload CSV" });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));

    await user.click(upload);
    const drawer = await screen.findByRole("dialog", { name: "Upload CSV" });
    const field = within(drawer).getByRole("textbox", { name: "File name" });
    await user.click(field);
    await user.keyboard("data.csv");
    expect((field as HTMLInputElement).value).toBe("data.csv");
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload CSV" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(upload));
    const dialog = screen.getByRole("dialog", { name: "Pick a dataset" });
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe("a footer link", () => {
  function linkDialog(action: Record<string, unknown>) {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Trace limit"
        primaryAction={{ label: "Compare plans", href: "#plans", ...action }}
      />,
    );
    return screen.findByRole("link", { name: "Compare plans" });
  }

  /** @scenario "A footer link is a real anchor that routes in-app only on a plain click" */
  it("is an anchor with the href; a plain click activates, then navigates once in-app", async () => {
    const onActivate = vi.fn();
    const onNavigate = vi.fn();
    const link = await linkDialog({ href: "/settings/subscription", onActivate, onNavigate });

    expect(link.getAttribute("href")).toBe("/settings/subscription");
    const notPrevented = fireEvent.click(link);

    expect(notPrevented).toBe(false);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ href: "/settings/subscription" });
  });

  /** @scenario "A footer link is a real anchor that routes in-app only on a plain click" */
  it("leaves native navigation alone when no onNavigate is given", async () => {
    const onActivate = vi.fn();
    const link = await linkDialog({ onActivate });

    expect(fireEvent.click(link)).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A footer link is a real anchor that routes in-app only on a plain click" */
  it("stays native for a modified click, a middle click and a _blank link", async () => {
    const onActivate = vi.fn();
    const onNavigate = vi.fn();
    const link = await linkDialog({ onActivate, onNavigate });

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(fireEvent.click(link, modifier)).toBe(true);
    }
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    cleanup();
    const blank = await linkDialog({ target: "_blank", onActivate, onNavigate });
    expect(fireEvent.click(blank)).toBe(true);

    expect(onActivate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  /** @scenario "A footer link is a real anchor that routes in-app only on a plain click" */
  it("keeps the supplied rel tokens and adds noopener to a _blank link", async () => {
    const link = await linkDialog({ target: "_blank", rel: "external" });

    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(" ").toSorted()).toEqual(["external", "noopener"]);
  });

  /** @scenario "A busy or unavailable footer link cannot be followed" */
  it.each([
    ["loading", { loading: true }],
    ["unavailable", { disabledReason: "Only admins can compare plans" }],
  ])("cannot be followed while %s", async (_name, extra) => {
    const onActivate = vi.fn();
    const onNavigate = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Trace limit"
        primaryAction={{ label: "Compare plans", href: "#plans", onActivate, onNavigate, ...extra }}
      />,
    );
    const link = await screen.findByRole("link", { name: "Compare plans" });

    expect(link.hasAttribute("href")).toBe(false);
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true }))).toBe(
      false,
    );
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  /** @scenario "A footer link is a real anchor that routes in-app only on a plain click" */
  it("is drawn by a drawer footer too, and a busy shape blocks it", async () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="Instance"
        busy
        footer={{ secondaryActions: [{ label: "Open full page", href: "#full" }] }}
      />,
    );

    const link = await screen.findByRole("link", { name: "Open full page" });
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("a dialog's secondary actions", () => {
  /** @scenario "A dialog draws several secondary actions and each carries a tone" */
  it("draws them in order before the primary, with no Cancel, and runs the one chosen", async () => {
    const onRemove = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Secure your account"
        secondaryAction={{ label: "Not now", onClick: vi.fn() }}
        secondaryActions={[{ label: "Remove", tone: "danger", onClick: onRemove }]}
        primaryAction={{ label: "Create a passkey", onClick: vi.fn() }}
      />,
    );

    const names = (await screen.findAllByRole("button"))
      .map((button) => button.textContent)
      .filter((name) => ["Not now", "Remove", "Create a passkey", "Cancel"].includes(name ?? ""));
    expect(names).toEqual(["Not now", "Remove", "Create a passkey"]);
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(rulesOf(remove)).toContain("--chakra-colors-red-muted");
    await userEvent.setup().click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A dialog draws several secondary actions and each carries a tone" */
  it("tones the singular secondary action", async () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Profile photo"
        cancelLabel={null}
        secondaryAction={{ label: "Remove", tone: "danger", onClick: vi.fn() }}
      />,
    );

    const remove = await screen.findByRole("button", { name: "Remove" });
    expect(rulesOf(remove)).toContain("--chakra-colors-red-muted");
  });
});

describe("a dialog opened from a menu", () => {
  beforeEach(stubLayout);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Impersonate() {
    const [open, setOpen] = useState(false);
    const reason = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    return (
      <>
        <Menu.Root onSelect={() => setOpen(true)}>
          <Menu.Trigger asChild>
            <button type="button" ref={trigger}>
              Row actions
            </button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="impersonate">Impersonate</Menu.Item>
          </Menu.Content>
        </Menu.Root>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Impersonate user"
          initialFocusEl={() => reason.current}
          finalFocusEl={() => trigger.current}
          primaryAction={{ label: "Start", onClick: vi.fn() }}
        >
          <input ref={reason} aria-label="Reason" />
        </Dialog>
      </>
    );
  }

  /** @scenario "A dialog opened from a menu focuses the requested field and returns focus to the trigger" */
  it("focuses the reason at once, types into it, contains Tab and returns to the trigger", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Impersonate />);
    const trigger = screen.getByRole("button", { name: "Row actions" });

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Impersonate" }));
    const dialog = await screen.findByRole("dialog", { name: "Impersonate user" });
    const reason = within(dialog).getByRole("textbox", { name: "Reason" });
    await waitFor(() => expect(document.activeElement).toBe(reason));

    await user.keyboard("support ticket");
    expect((reason as HTMLInputElement).value).toBe("support ticket");
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let step = 0; step < 6; step += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
