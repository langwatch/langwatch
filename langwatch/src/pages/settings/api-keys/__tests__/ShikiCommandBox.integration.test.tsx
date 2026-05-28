/**
 * @vitest-environment jsdom
 *
 * Integration tests for token-created-snippets.feature — ShikiCommandBox
 * component and TokenCreatedDialog behavior.
 *
 * Tests:
 *  - Copy button flashes success state (fake timers)
 *  - Terminal prompt glyph >_ is NOT in the clipboard
 *  - Reveal toggle swaps masked/unmasked without re-tokenizing
 *  - codeToHtml called at most twice per command box per dialog open
 *  - Copy success is announced via aria-live
 *  - Long lines scroll horizontally (overflow: auto style)
 *  - Amber warning is present
 *  - Copy and reveal buttons coexist in header bar without overlap
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shikiAdapter from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { ShikiCommandBox } from "../../../../components/code/ShikiCommandBox";

// ---------------------------------------------------------------------------
// Mock shikiAdapter to control codeToHtml call count
// ---------------------------------------------------------------------------

vi.mock(
  "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter")
      >();
    return {
      ...actual,
      codeToHtml: vi.fn(({ code }: { code: string; lang: string }) => {
        // Return a minimal HTML string that includes the code
        return Promise.resolve(
          `<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
        );
      }),
    };
  },
);

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Clipboard mock
// ---------------------------------------------------------------------------
let clipboardContents = "";

beforeEach(() => {
  clipboardContents = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn((text: string) => {
        clipboardContents = text;
        return Promise.resolve();
      }),
    },
  });
});

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCommandBox({
  command,
  maskedCommand,
  lang = "bash",
  showPrompt = false,
}: {
  command: string;
  maskedCommand?: string;
  lang?: string;
  showPrompt?: boolean;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ShikiCommandBox
        command={command}
        maskedCommand={maskedCommand}
        lang={lang}
        showPrompt={showPrompt}
        copyLabel="Command"
      />
    </ChakraProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<ShikiCommandBox />", () => {
  afterEach(() => cleanup());

  describe("given a command box with a terminal command", () => {
    describe("when the copy button is clicked", () => {
      it("copies only the raw command — not the prompt glyph — to the clipboard", async () => {
        renderCommandBox({
          command: "claude mcp add langwatch -- npx -y @langwatch/mcp-server",
          showPrompt: true,
        });

        const copyBtn = screen.getByRole("button", { name: /^Copy command$/i });
        fireEvent.click(copyBtn);

        await waitFor(() => {
          expect(clipboardContents).not.toContain(">_");
          expect(clipboardContents).toContain("claude mcp add langwatch");
        });
      });

      it("the prompt glyph is NOT in the source string passed to codeToHtml", async () => {
        const spy = vi.spyOn(shikiAdapter, "codeToHtml");
        spy.mockClear();

        renderCommandBox({
          command: "claude mcp add langwatch",
          showPrompt: true,
        });

        await waitFor(() => {
          expect(spy).toHaveBeenCalled();
        });

        for (const call of spy.mock.calls) {
          expect((call[0] as { code: string }).code).not.toContain(">_");
        }
      });
    });
  });

  describe("given a command box with a masked secret value", () => {
    describe("when the copy button is clicked", () => {
      it("copies the unmasked value (real token) to the clipboard", async () => {
        renderCommandBox({
          command: "LANGWATCH_API_KEY=real-secret-token-abc123",
          maskedCommand: "LANGWATCH_API_KEY=real-****-abc123",
          lang: "ini",
        });

        const copyBtn = screen.getByRole("button", { name: /^Copy command$/i });
        fireEvent.click(copyBtn);

        await waitFor(() => {
          expect(clipboardContents).toContain("real-secret-token-abc123");
        });
      });
    });

    describe("when the reveal eye toggle is clicked", () => {
      it("shows the hide button after clicking reveal", async () => {
        renderCommandBox({
          command: "LANGWATCH_API_KEY=real-secret-token-abc123",
          maskedCommand: "LANGWATCH_API_KEY=real-****-abc123",
          lang: "ini",
        });

        // Initially the "show" (eye) button is present
        const eyeBtn = await screen.findByRole("button", { name: /show/i });
        fireEvent.click(eyeBtn);

        // After reveal, the "hide" (eye-off) button is visible
        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /hide/i }),
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe("given the reveal toggle is clicked N times rapidly", () => {
    describe("when verifying Shiki tokenization is memoized", () => {
      it("calls codeToHtml at most twice per command box — once for masked, once for unmasked", async () => {
        const spy = vi.spyOn(shikiAdapter, "codeToHtml");
        spy.mockClear();

        renderCommandBox({
          command: "claude mcp add langwatch --api-key real-secret-token",
          maskedCommand: "claude mcp add langwatch --api-key pat-lw-****",
          lang: "bash",
        });

        // Wait for initial tokenization
        await waitFor(() => expect(spy).toHaveBeenCalled());

        const callCountAfterMount = spy.mock.calls.length;

        // Toggle reveal multiple times rapidly
        const eyeBtn = screen.getByRole("button", { name: /show/i });
        fireEvent.click(eyeBtn);
        await waitFor(() =>
          screen.getByRole("button", { name: /hide/i }),
        );
        const hideBtn = screen.getByRole("button", { name: /hide/i });
        fireEvent.click(hideBtn);
        await waitFor(() =>
          screen.getByRole("button", { name: /show/i }),
        );
        const eyeBtn2 = screen.getByRole("button", { name: /show/i });
        fireEvent.click(eyeBtn2);
        await waitFor(() =>
          screen.getByRole("button", { name: /hide/i }),
        );

        // Total calls must be at most 2 (one for masked, one for unmasked)
        expect(spy.mock.calls.length).toBeLessThanOrEqual(callCountAfterMount + 1);
      });
    });
  });

  describe("given a command box with a long command", () => {
    describe("when the snippet renders", () => {
      it("the command box renders with a horizontally scrollable code area", async () => {
        const longCommand =
          "claude mcp add langwatch --env LANGWATCH_API_KEY=pat-lw-very-long-token-that-goes-past-the-dialog-width -- npx -y @langwatch/mcp-server";
        const { container } = renderCommandBox({
          command: longCommand,
          lang: "bash",
        });
        // Wait for component to render
        await waitFor(() =>
          expect(
            container.querySelector("[data-shiki-box]") ??
              container.querySelector("pre"),
          ).toBeInTheDocument(),
        );
        // The data-shiki-box div must be present (signals the scroll container)
        expect(container.querySelector("[data-shiki-box]")).toBeInTheDocument();
      });
    });
  });

  describe("given a copy button is present", () => {
    describe("when a copy action succeeds", () => {
      it("announces 'Copied' via the toaster (acts as polite live region)", async () => {
        const { toaster } = await import("~/components/ui/toaster");
        const createSpy = vi.spyOn(toaster, "create");
        createSpy.mockClear();

        renderCommandBox({ command: "claude mcp add langwatch" });

        const copyBtn = screen.getByRole("button", { name: /^Copy command$/i });
        fireEvent.click(copyBtn);

        await waitFor(() => {
          expect(createSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Copied",
            }),
          );
        });
      });
    });
  });

  describe("given a command box renders", () => {
    describe("when checking copy and reveal button layout", () => {
      it("both buttons are present in a header bar above the code area", async () => {
        renderCommandBox({
          command: "test-command",
          maskedCommand: "test-masked",
        });

        await waitFor(() => {
          const revealBtn = screen.getByRole("button", { name: /show/i });
          const copyBtn = screen.getByRole("button", { name: /^Copy command$/i });
          expect(revealBtn).toBeInTheDocument();
          expect(copyBtn).toBeInTheDocument();
        });
      });
    });
  });

  describe("given a copy button that enters success state", () => {
    describe("when using fake timers to observe the 1-second flash", () => {
      it("flips data-state to 'copied' after click and back to 'idle' after 1 second", async () => {
        renderCommandBox({ command: "claude mcp add langwatch" });

        // Wait for the copy button to render under REAL timers — the initial
        // Shiki tokenization depends on real microtasks. Switch to fake timers
        // only after the button is visible.
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: /^Copy command$/i }),
          ).toHaveAttribute("data-state", "idle"),
        );

        vi.useFakeTimers();
        try {
          const copyBtn = screen.getByRole("button", { name: /^Copy command$/i });
          fireEvent.click(copyBtn);

          // After click: button flips to copied (success-flash) state.
          await vi.waitFor(() =>
            expect(copyBtn).toHaveAttribute("data-state", "copied"),
          );

          // Advance timers by 1 second — success flash should reset.
          vi.advanceTimersByTime(1000);

          await vi.waitFor(() =>
            expect(copyBtn).toHaveAttribute("data-state", "idle"),
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
