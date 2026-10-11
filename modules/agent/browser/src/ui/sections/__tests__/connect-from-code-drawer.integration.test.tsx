/**
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const appearance = vi.hoisted(() => ({
  colorMode: "light" as "light" | "dark",
  adapterModes: [] as string[],
}));

vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: appearance.colorMode }),
}));

// The real adapter loads Shiki; this one hands the code back in a <pre> tagged with its language.
vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: (mode: string) => {
    appearance.adapterModes.push(mode);
    return {
      loadContextSync: () => ({}),
      getHighlighter:
        () =>
        ({ code, language }: { code: string; language?: string }) => ({
          highlighted: true,
          code: `<pre data-highlighted-lang="${language}" data-mode="${mode}"><code>${code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</code></pre>`,
        }),
    };
  },
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { ConnectFromCodeDrawer } = await import("../connect-from-code-drawer.tsx");

function renderDrawer() {
  return renderWithDesignSystem(
    <ConnectFromCodeDrawer
      open
      onClose={vi.fn()}
      renderCopyButton={({ label }) => <button type="button">Copy {label}</button>}
    />,
  );
}

const highlightedAs = (language: string) =>
  document.querySelectorAll(`pre[data-highlighted-lang="${language}"]`);

afterEach(() => {
  cleanup();
  appearance.colorMode = "light";
  appearance.adapterModes.length = 0;
});

describe("the connect-from-code drawer", () => {
  describe("given it is open", () => {
    /** @scenario "The connect drawer offers the snippets and listens" */
    it("offers a Python and a TypeScript snippet and shows it is listening", async () => {
      renderDrawer();

      expect(screen.getByRole("tab", { name: "Python" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "TypeScript" })).toBeInTheDocument();
      expect(await screen.findByText(/@langwatch\.connect_agent/)).toBeInTheDocument();
      expect(screen.getByTestId("connect-agent-listening")).toHaveTextContent(
        "Waiting for an agent to connect",
      );
    });

    /** @scenario "The connect snippets are syntax highlighted" */
    it("highlights the install line as shell and each snippet as its language, in the app mode", async () => {
      renderDrawer();

      await waitFor(() => expect(highlightedAs("python")).toHaveLength(1));
      expect(highlightedAs("typescript")).toHaveLength(1);
      expect(highlightedAs("bash")).toHaveLength(2);
      expect(highlightedAs("bash")[0]).toHaveTextContent("pip install langwatch");
      expect(new Set(appearance.adapterModes)).toEqual(new Set(["light"]));

      let node: HTMLElement | null = highlightedAs("python")[0] as HTMLElement;
      const scrolls: string[] = [];
      while (node) {
        scrolls.push(getComputedStyle(node).overflowX);
        node = node.parentElement;
      }
      expect(scrolls).toContain("auto");
    });

    /** @scenario "The connect snippets are syntax highlighted" */
    it("highlights with the dark theme when the app is dark", async () => {
      appearance.colorMode = "dark";
      renderDrawer();

      await waitFor(() => expect(highlightedAs("python")).toHaveLength(1));
      expect(new Set(appearance.adapterModes)).toEqual(new Set(["dark"]));
    });
  });
  describe("given it was opened from another drawer", () => {
    function renderWithBack() {
      const onClose = vi.fn();
      const onGoBack = vi.fn();
      renderWithDesignSystem(
        <ConnectFromCodeDrawer
          open
          onClose={onClose}
          onGoBack={onGoBack}
          renderCopyButton={({ label }) => <button type="button">Copy {label}</button>}
        />,
      );
      return { onClose, onGoBack };
    }

    it("goes back once from the labelled back button without closing", async () => {
      const { onClose, onGoBack } = renderWithBack();

      const back = screen.getByRole("button", { name: "Back" });
      expect(back).toHaveAttribute("data-testid", "back-button");
      await userEvent.click(back);

      expect(onGoBack).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes from the close button and from Escape", async () => {
      const { onClose, onGoBack } = renderWithBack();

      await userEvent.click(screen.getByRole("button", { name: /^close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
      expect(onGoBack).not.toHaveBeenCalled();
    });
  });
});
