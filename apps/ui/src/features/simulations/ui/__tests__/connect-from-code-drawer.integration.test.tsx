/**
 * The drawer that connects an agent from code, opened from the new agent flow.
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem, type CodeBlockAdapter } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorModeProvider } from "@langwatch/design-system/color-mode";
import { ConnectFromCodeDrawer } from "../sections/connected-agent-drawers.tsx";

const highlighter = vi.hoisted(() => {
  const highlight = ({ code, language }: { code: string; language?: string }) => ({
    code: `<span data-highlighted-lang="${language}">${code
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</span>`,
    highlighted: true,
  });

  return { light: vi.fn(highlight), dark: vi.fn(highlight) };
});

vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: (colorMode: "light" | "dark"): CodeBlockAdapter => ({
    getHighlighter: () => highlighter[colorMode],
  }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
}));

// The agent-setup menu reaches the API and the Langy store; the drawer
// only mounts it, so the boundary is mocked here.
vi.mock("@langwatch/trace-web/surfaces/setup-with-agent-button", () => ({
  SetupWithAgentButton: ({ surface }: { surface: string }) => (
    <button data-testid="setup-with-agent" data-surface={surface}>
      Setup via Agent
    </button>
  ),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ConnectFromCodeDrawer />", () => {
  beforeEach(() => {
    const matchMedia = (media: string): MediaQueryList => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    });

    vi.stubGlobal("matchMedia", matchMedia);
    highlighter.light.mockClear();
    highlighter.dark.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("given the drawer is open", () => {
    /** @scenario "The connect snippets are syntax highlighted" */
    it("highlights the install line as bash and each snippet as its language, in the app color mode", async () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      // The plain-text fallback shows the same code until the highlight
      // lands, so the highlighted <pre> is awaited before its text is read.
      const highlightedIn = async ({ block, lang }: { block: HTMLElement; lang: string }) => {
        await waitFor(() =>
          expect(block.querySelector("[data-highlighted-lang]")).toHaveAttribute(
            "data-highlighted-lang",
            lang,
          ),
        );
        return within(block);
      };

      const pythonBlock = screen.getByTestId("connect-code-python");
      const python = await highlightedIn({
        block: pythonBlock,
        lang: "python",
      });
      expect(python.getByText(/@langwatch\.connect_agent/)).toBeInTheDocument();

      const typescript = await highlightedIn({
        block: screen.getByTestId("connect-code-typescript"),
        lang: "typescript",
      });
      expect(typescript.getByText(/connectAgent\(/)).toBeInTheDocument();

      const installs = screen.getAllByTestId("connect-code-bash");
      expect(installs).toHaveLength(2);
      const install = await highlightedIn({
        block: installs[0]!,
        lang: "bash",
      });
      expect(install.getByText("pip install langwatch")).toBeInTheDocument();

      expect(highlighter.light).toHaveBeenCalled();
      expect(highlighter.dark).not.toHaveBeenCalled();

      // A snippet line is as long as the agent name makes it, so the block
      // scrolls sideways rather than wrapping or clipping what it cannot fit.
      const pre = pythonBlock.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre!).toHaveStyle({ whiteSpace: "pre", overflowX: "auto" });
    });

    /** @scenario "The connect snippets are syntax highlighted" */
    it("highlights with the dark theme when the app is in dark mode", async () => {
      render(
        <ColorModeProvider defaultTheme="dark">
          <ConnectFromCodeDrawer open />
        </ColorModeProvider>,
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(highlighter.dark).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByTestId("connect-code-python").querySelector("[data-highlighted-lang]"),
        ).toBeInTheDocument(),
      );
    });

    /** @scenario "The connect drawer leads with the agent setup" */
    it("offers the agent setup for the connect-agent surface first", () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      const setup = screen.getByTestId("setup-with-agent");
      expect(setup).toBeInTheDocument();
      expect(setup.dataset.surface).toBe("connectedAgents");
    });

    /** @scenario "The connect drawer offers the snippets and listens" */
    it("offers a Python snippet, a TypeScript snippet and a listening indicator", () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText(/@langwatch\.connect_agent/)).toBeInTheDocument();
      expect(screen.getByTestId("connect-agent-listening")).toBeInTheDocument();
    });
  });
});
import "@testing-library/jest-dom/vitest";
