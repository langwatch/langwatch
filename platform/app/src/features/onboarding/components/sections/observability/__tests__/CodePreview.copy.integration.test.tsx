/**
 * @vitest-environment jsdom
 *
 * The default Chakra CodeBlock copy trigger copies whatever string is
 * rendered — which is the masked form when a sensitive snippet is hidden.
 * A user who copies "sk-l***...***X6RA" into their .env gets a broken SDK
 * with no error pointing here. `copyText` feeds the clipboard the real
 * value regardless of reveal state.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodePreview } from "../CodePreview";

// Shiki is loaded lazily by CodePreview's adapter; in jsdom the real wasm
// highlighter is both slow and unnecessary — the copy path never touches it.
vi.mock("shiki", () => ({
  createHighlighter: () =>
    Promise.resolve({
      codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { toaster } from "~/components/ui/toaster";

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

const TOKEN = "sk-lw-real-secret-token-value";
const CODE = `LANGWATCH_API_KEY="${TOKEN}"\nLANGWATCH_PROJECT_ID="project-abc"`;

function renderMaskedPreview() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CodePreview
        code={CODE}
        copyText={CODE}
        filename=".env"
        codeLanguage="bash"
        sensitiveValue={TOKEN}
        enableVisibilityToggle
        isVisible={false}
        onToggleVisibility={() => void 0}
      />
    </ChakraProvider>,
  );
}

describe("<CodePreview />", () => {
  afterEach(cleanup);

  describe("given a masked snippet with copyText", () => {
    describe("when the copy button is clicked without revealing first", () => {
      /** @scenario Copy delivers the real value even while the snippet is masked */
      it("copies the real unmasked value to the clipboard", async () => {
        renderMaskedPreview();

        const copyButton = await screen.findByRole("button", {
          name: /copy/i,
        });
        fireEvent.click(copyButton);

        expect(clipboardContents).toBe(CODE);
        expect(clipboardContents).toContain(TOKEN);
      });

      /** @scenario Copy button is present on every command box */
      it("keeps the masked form on screen while copying the real value", async () => {
        renderMaskedPreview();

        const copyButton = await screen.findByRole("button", {
          name: /copy/i,
        });
        fireEvent.click(copyButton);

        expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
        expect(clipboardContents).toContain(TOKEN);
      });
    });

    describe("when the copy button is clicked", () => {
      /** @scenario Copy button flashes a success state on click */
      it("flashes a success state and returns to default after 2 seconds", async () => {
        vi.useFakeTimers();
        try {
          renderMaskedPreview();

          // findBy* does not play well with fake timers; the button is
          // rendered synchronously after ClientOnly's mount effect, which
          // fake timers do not gate.
          const copyButton = screen.getByRole("button", { name: /copy/i });
          fireEvent.click(copyButton);
          // The copied-state updates land after awaited clipboard promises,
          // outside fireEvent's act() — advance timers inside act so React
          // flushes them.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });

          expect(copyButton.querySelector("svg.lucide-check")).not.toBeNull();

          await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
          });
          expect(copyButton.querySelector("svg.lucide-check")).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      /** @scenario Copy success is announced to assistive tech */
      it("announces the copy through the toaster live region", async () => {
        renderMaskedPreview();

        const copyButton = await screen.findByRole("button", {
          name: /copy/i,
        });
        fireEvent.click(copyButton);

        await vi.waitFor(() => {
          expect(toaster.create).toHaveBeenCalledWith(
            expect.objectContaining({ type: "success" }),
          );
        });
      });
    });
  });
});
