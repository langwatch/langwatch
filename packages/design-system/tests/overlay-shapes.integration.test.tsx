// @vitest-environment jsdom
/** The drawer and dialog shapes (ADR-002): slots, close requests, forms, states, portals, focus. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Select } from "../src/components/forms/select.tsx";
import { ConfirmDialog } from "../src/components/overlays/confirm-dialog.tsx";
import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { Menu } from "../src/components/overlays/menu.tsx";
import { createListCollection } from "../src/primitives.ts";
import { DesignSystemProvider } from "../src/provider/index.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function Crash(): never {
  throw new Error("boom: secret internals");
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
      expect((close as HTMLButtonElement).disabled).toBe(true);
      await user.click(screen.getByText("Budget"));
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("given the drawer owns its form", () => {
    /** @scenario "A footer submit action submits the right form once" */
    it("submits once from the submit action and once from Enter", async () => {
      const onSubmit = vi.fn();
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

      fireEvent.click(await screen.findByRole("button", { name: "Create budget" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      fireEvent.submit(screen.getByRole("textbox", { name: "Name" }));
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
    // jsdom lays nothing out, so the focus trap would treat every element as hidden.
    beforeEach(() => {
      const rect = new DOMRect(0, 0, 10, 10);
      const rects: DOMRectList = {
        0: rect,
        length: 1,
        item: (index: number) => (index === 0 ? rect : null),
        [Symbol.iterator]: () => [rect][Symbol.iterator](),
      };
      vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(rects);
    });
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
