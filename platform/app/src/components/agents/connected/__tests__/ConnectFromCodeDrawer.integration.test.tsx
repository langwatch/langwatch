/**
 * @vitest-environment jsdom
 *
 * The drawer that connects an agent from code, opened from the new
 * agent flow.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorModeProvider } from "~/components/ui/color-mode";
import { ConnectFromCodeDrawer } from "../ConnectFromCodeDrawer";

// The real adapter loads Shiki's grammars and themes. This one records the
// language each block was highlighted as and hands the code back in a <pre>
// tagged with it, which is what the assertions read.
const highlighter = vi.hoisted(() => {
  const escape = (code: string) =>
    code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const highlight = ({ code, lang }: { code: string; lang: string }) =>
    Promise.resolve(
      `<pre data-highlighted-lang="${lang}"><code>${escape(code)}</code></pre>`,
    );
  return { light: vi.fn(highlight), dark: vi.fn(highlight) };
});

vi.mock(
  "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter",
  () => ({
    codeToHtml: highlighter.light,
    codeToHtmlDark: highlighter.dark,
  }),
);

vi.mock("~/hooks/useDrawer", () => ({
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
vi.mock("~/components/SetupWithAgentButton", () => ({
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
    highlighter.light.mockClear();
    highlighter.dark.mockClear();
  });
  afterEach(cleanup);

  describe("given the drawer is open", () => {
    /** @scenario "The connect snippets are syntax highlighted" */
    it("highlights the install line as bash and each snippet as its language, in the app color mode", async () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      // The plain-text fallback shows the same code until the highlight
      // lands, so the highlighted <pre> is awaited before its text is read.
      const highlightedIn = async (block: HTMLElement, lang: string) => {
        await waitFor(() =>
          expect(
            block.querySelector("[data-highlighted-lang]"),
          ).toHaveAttribute("data-highlighted-lang", lang),
        );
        return within(block);
      };

      const python = await highlightedIn(
        screen.getByTestId("connect-code-python"),
        "python",
      );
      expect(python.getByText(/@langwatch\.connect_agent/)).toBeInTheDocument();

      const typescript = await highlightedIn(
        screen.getByTestId("connect-code-typescript"),
        "typescript",
      );
      expect(typescript.getByText(/connectAgent\(/)).toBeInTheDocument();

      const installs = screen.getAllByTestId("connect-code-bash");
      expect(installs).toHaveLength(2);
      const install = await highlightedIn(installs[0]!, "bash");
      expect(install.getByText("pip install langwatch")).toBeInTheDocument();

      expect(highlighter.light).toHaveBeenCalled();
      expect(highlighter.dark).not.toHaveBeenCalled();
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
          screen
            .getByTestId("connect-code-python")
            .querySelector("[data-highlighted-lang]"),
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
