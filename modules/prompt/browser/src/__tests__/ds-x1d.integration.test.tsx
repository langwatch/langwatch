/**
 * @vitest-environment jsdom
 * Tab keyboard and panel relationships: the draggable document tabs (a named raw escape) keep
 * one tab stop and the arrow keys, and the API snippet dialog's language tabs are wired to its
 * one preview panel.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { Snippet, Target } from "../ui/sections/api-snippet/openapi-snippet.types.ts";
import { DraggableTabsBrowser } from "../ui/sections/prompt-studio/browser/draggable-tabs-browser.tsx";
import { GenerateApiSnippetDialog } from "../ui/sections/prompt-studio/dialogs/generate-api-snippet-dialog.tsx";

afterEach(cleanup);

function ThreeTabWindow({ onTabChange }: { onTabChange: (change: { tabId: string }) => void }) {
  const [active, setActive] = useState("tab-1");
  return (
    <DraggableTabsBrowser.Root onTabMove={vi.fn()}>
      <DraggableTabsBrowser.Window
        windowId="window-1"
        activeTabId={active}
        onTabChange={({ tabId }) => {
          setActive(tabId);
          onTabChange({ tabId });
        }}
      >
        <DraggableTabsBrowser.TabBar tabIds={["tab-1", "tab-2", "tab-3"]}>
          {["tab-1", "tab-2", "tab-3"].map((id) => (
            <DraggableTabsBrowser.Tab key={id} id={id}>
              <DraggableTabsBrowser.Trigger
                value={id}
              >{`Prompt ${id}`}</DraggableTabsBrowser.Trigger>
            </DraggableTabsBrowser.Tab>
          ))}
        </DraggableTabsBrowser.TabBar>
        {["tab-1", "tab-2", "tab-3"].map((id) => (
          <DraggableTabsBrowser.Content key={id} value={id}>
            <div>{`Body of ${id}`}</div>
          </DraggableTabsBrowser.Content>
        ))}
      </DraggableTabsBrowser.Window>
    </DraggableTabsBrowser.Root>
  );
}

describe("DraggableTabsBrowser keyboard", () => {
  describe("when the window shows three sortable tabs", () => {
    it("holds only tabs in the tablist and one tab stop on the selected tab", () => {
      renderWithDesignSystem(<ThreeTabWindow onTabChange={vi.fn()} />);

      const tablist = screen.getByRole("tablist");
      expect(within(tablist).queryAllByRole("button")).toHaveLength(0);
      const tabs = within(tablist).getAllByRole("tab");
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    });

    it("points the selected tab at the panel it labels", () => {
      renderWithDesignSystem(<ThreeTabWindow onTabChange={vi.fn()} />);

      const tab = screen.getByRole("tab", { name: "Prompt tab-1" });
      const panel = screen.getByRole("tabpanel");
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      expect(panel).toHaveTextContent("Body of tab-1");
    });
  });

  describe("when the reader presses the arrow keys on the focused tab", () => {
    it("moves focus with Right, Left, End and Home, wrapping, and Enter selects the focused tab", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderWithDesignSystem(<ThreeTabWindow onTabChange={onTabChange} />);

      await user.tab();
      expect(screen.getByRole("tab", { name: "Prompt tab-1" })).toHaveFocus();

      const moveTo = async ({ key, tab }: { key: string; tab: string }) => {
        await user.keyboard(key);
        await waitFor(() => expect(screen.getByRole("tab", { name: tab })).toHaveFocus());
      };
      await moveTo({ key: "{ArrowRight}", tab: "Prompt tab-2" });
      await moveTo({ key: "{End}", tab: "Prompt tab-3" });
      await moveTo({ key: "{ArrowRight}", tab: "Prompt tab-1" });
      await moveTo({ key: "{ArrowLeft}", tab: "Prompt tab-3" });
      await moveTo({ key: "{Home}", tab: "Prompt tab-1" });
      await moveTo({ key: "{ArrowRight}", tab: "Prompt tab-2" });

      await user.keyboard("{Enter}");
      await waitFor(() => expect(onTabChange).toHaveBeenLastCalledWith({ tabId: "tab-2" }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Prompt tab-2" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
      expect(await screen.findByText("Body of tab-2")).toBeInTheDocument();
      expect(screen.queryByText("Body of tab-1")).not.toBeInTheDocument();
    });

    it("moves focus out of the strip with Tab and back with Shift-Tab", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<ThreeTabWindow onTabChange={vi.fn()} />);

      await user.tab();
      expect(screen.getByRole("tab", { name: "Prompt tab-1" })).toHaveFocus();
      await user.tab();

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveFocus();
      await user.tab({ shift: true });
      expect(screen.getByRole("tab", { name: "Prompt tab-1" })).toHaveFocus();
    });
  });
});

const SNIPPETS: Snippet[] = [
  { target: "python_python3", content: "print('sk-lw-secret123')", title: "Python" },
  { target: "node_native", content: "console.log('sk-lw-secret123')", title: "TypeScript" },
  { target: "shell_curl", content: "curl -H 'sk-lw-secret123'", title: "cURL" },
];
const TARGETS: Target[] = SNIPPETS.map((snippet) => snippet.target);

describe("GenerateApiSnippetDialog language tabs", () => {
  function renderDialog({
    onOpenChange = vi.fn(),
  }: { onOpenChange?: (open: boolean) => void } = {}) {
    return renderWithDesignSystem(
      <GenerateApiSnippetDialog
        open
        onOpenChange={onOpenChange}
        snippets={SNIPPETS}
        targets={TARGETS}
        title="Call this prompt"
        sensitiveValue="sk-lw-secret123"
      />,
    );
  }

  describe("when the dialog opens", () => {
    it("names the dialog and has the one X to close it, no footer", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderDialog({ onOpenChange });

      expect(screen.getByRole("dialog", { name: "Call this prompt" })).toBeInTheDocument();
      expect(screen.getByRole("tablist", { name: "Snippet language" })).toBeInTheDocument();
      const close = screen.getAllByRole("button", { name: "Close" });
      expect(close).toHaveLength(1);

      await user.click(close[0]!);
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("closes once on Escape", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderDialog({ onOpenChange });

      const dialog = screen.getByRole("dialog");
      screen.getByRole("tab", { name: "Python" }).focus();
      expect(dialog.contains(document.activeElement)).toBe(true);
      // The dismiss layer arms a moment after mount, so press until it answers.
      await waitFor(async () => {
        await user.keyboard("{Escape}");
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(onOpenChange).toHaveBeenCalledTimes(1);
    });

    it("has one panel, labelled by the selected language and controlled by it", async () => {
      renderDialog();

      const panel = screen.getByRole("tabpanel");
      const python = screen.getByRole("tab", { name: "Python" });
      expect(python).toHaveAttribute("aria-selected", "true");
      expect(python.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel).toHaveAttribute("aria-labelledby", python.id);
      expect(await within(panel).findByText(/print\(/)).toBeInTheDocument();
    });
  });

  describe("when the reader picks another language", () => {
    it("keeps the one preview, its revealed state and the unmasked copy", async () => {
      const user = userEvent.setup();
      renderDialog();
      const panel = screen.getByRole("tabpanel");
      await within(panel).findByText(/print\(/);
      expect(panel).toHaveTextContent("sk-l***...***123");

      await user.click(screen.getByRole("button", { name: "Show sensitive values" }));
      expect(panel).toHaveTextContent("sk-lw-secret123");

      await user.click(screen.getByRole("tab", { name: "cURL" }));
      const curl = screen.getByRole("tab", { name: "cURL" });
      expect(screen.getByRole("tabpanel")).toBe(panel);
      expect(panel).toHaveAttribute("aria-labelledby", curl.id);
      expect(curl.getAttribute("aria-controls")).toBe(panel.id);
      await waitFor(() => expect(panel).toHaveTextContent("curl -H"));
      expect(screen.getByRole("button", { name: "Hide sensitive values" })).toBeInTheDocument();
      expect(panel).toHaveTextContent("sk-lw-secret123");

      await user.click(screen.getByRole("button", { name: /^Copy / }));
      expect(await navigator.clipboard.readText()).toBe("curl -H 'sk-lw-secret123'");
    });

    it("moves between languages with the arrow keys", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole("tab", { name: "cURL" }));
      await user.keyboard("{ArrowLeft}");
      await waitFor(() => expect(screen.getByRole("tab", { name: "TypeScript" })).toHaveFocus());
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(screen.getByRole("tabpanel")).toHaveAttribute(
          "aria-labelledby",
          screen.getByRole("tab", { name: "TypeScript" }).id,
        ),
      );
    });
  });

  describe("when the dialog manages its own open state", () => {
    it("opens from its Trigger and closes from the X", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <GenerateApiSnippetDialog snippets={SNIPPETS} targets={TARGETS} title="Call this prompt">
          <GenerateApiSnippetDialog.Trigger>
            <button type="button">Show API</button>
          </GenerateApiSnippetDialog.Trigger>
        </GenerateApiSnippetDialog>,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Show API" }));
      expect(await screen.findByRole("dialog", { name: "Call this prompt" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });
});
