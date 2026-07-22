/**
 * @vitest-environment jsdom
 *
 * The created-key dialog, at the dialog level — the redesign's own structure,
 * which the ShikiCommandBox component tests do not exercise.
 *
 * Pins three things the rewrite is responsible for and nothing else was
 * asserting:
 *   - the credential card shows the key masked, and reveals the real one;
 *   - the destinations are a single row (.env / HTTP / Claude Code / Codex /
 *     MCP config), and selecting one shows exactly its snippet;
 *   - HTTP shows Bearer AND Basic together rather than behind a sub-tab.
 *
 * ShikiCommandBox is stubbed through the dynamic() boundary to render its
 * unmasked `command` synchronously — the same seam the rotation test uses —
 * so a destination's snippet is assertable by its text. Its own copy / reveal
 * / tokenisation behaviour lives in ShikiCommandBox.integration.test.tsx.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Render ShikiCommandBox synchronously as its raw (unmasked) command so each
// destination's snippet is assertable by text. React.lazy (what next-dynamic
// wraps) suspends for a tick in jsdom otherwise.
vi.mock("~/utils/compat/next-dynamic", () => ({
  default:
    (_importFn: () => Promise<unknown>) =>
    function DynamicStub(props: Record<string, unknown>) {
      return <pre data-testid="snippet">{String(props.command ?? "")}</pre>;
    },
}));

// The JSON config block is Shiki-backed; its highlighting is covered elsewhere.
// Here it only needs to render its code so the MCP destination is assertable.
vi.mock(
  "../../../../features/onboarding/components/sections/shared/JsonHighlight",
  () => ({
    JsonHighlight: ({ code }: { code: string }) => (
      <pre data-testid="json-config">{code}</pre>
    ),
  }),
);

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { TokenCreatedDialog } from "../TokenCreatedDialog";

const TOKEN = "sk-lw-created-key-abcdefghijklmnop";
const ENDPOINT = "https://app.langwatch.ai";

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof TokenCreatedDialog>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TokenCreatedDialog
        newToken={TOKEN}
        projectId="proj-1"
        endpoint={ENDPOINT}
        orgProjects={[{ id: "proj-1", name: "Proj One" }]}
        onClose={vi.fn()}
        {...overrides}
      />
    </ChakraProvider>,
  );
}

/** The single visible snippet's text (destinations mount one at a time). */
const snippetText = () =>
  screen
    .getAllByTestId("snippet")
    .map((node) => node.textContent ?? "")
    .join("\n");

const pickDestination = (label: string) =>
  fireEvent.click(screen.getByRole("button", { name: label }));

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => cleanup());

describe("the created-key dialog", () => {
  describe("given it has just opened", () => {
    it("titles the moment as a created secret key", () => {
      renderDialog();
      expect(screen.getByText("Secret key created")).toBeInTheDocument();
    });

    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("keeps the one-time warning in view", () => {
      renderDialog();
      expect(
        screen.getByText(/Copy this token now\. You won't be able to see it again\./),
      ).toBeInTheDocument();
    });
  });

  describe("given the credential card", () => {
    /** @scenario The key leads the dialog, masked until asked for */
    it("shows the key masked, not in the clear", () => {
      renderDialog();
      // first 6 + bullets + last 4 — the card's masked form, distinct from the
      // full token that the default .env snippet carries.
      expect(screen.getByText(/^sk-lw-•+mnop$/)).toBeInTheDocument();
    });

    /** @scenario The key leads the dialog, masked until asked for */
    it("reveals the real key when asked", async () => {
      renderDialog();
      fireEvent.click(
        screen.getByRole("button", { name: /show secret key/i }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /hide secret key/i }),
        ).toBeInTheDocument(),
      );
      // The real key now appears in the card itself, not only in a snippet.
      const cardKeys = screen
        .getAllByText(TOKEN)
        .filter((node) => node.getAttribute("data-testid") !== "snippet");
      expect(cardKeys.length).toBeGreaterThan(0);
    });

    it("offers a copy of the key", () => {
      renderDialog();
      expect(
        screen.getByRole("button", { name: /^Copy$/ }),
      ).toBeInTheDocument();
    });
  });

  describe("given the destinations", () => {
    /** @scenario .env tab renders as a highlighted ini command box */
    it("opens on .env, carrying the real key", () => {
      renderDialog();
      const text = snippetText();
      expect(text).toContain("LANGWATCH_API_KEY=");
      expect(text).toContain(TOKEN);
      expect(text).toContain("LANGWATCH_ENDPOINT");
    });

    /** @scenario Claude Code tab shows a PostHog-style terminal command snippet */
    it("shows the claude command under Claude Code", () => {
      renderDialog();
      pickDestination("Claude Code");
      expect(snippetText()).toContain("claude mcp add langwatch");
    });

    /** @scenario Codex tab shows a PostHog-style terminal command snippet */
    it("shows the codex command under Codex", () => {
      renderDialog();
      pickDestination("Codex");
      expect(snippetText()).toContain("codex mcp add langwatch");
    });

    /** @scenario Bearer tab renders as a highlighted shell command box */
    /** @scenario Basic Auth tab renders as a highlighted shell command box */
    it("shows Bearer and Basic together under HTTP", () => {
      renderDialog();
      pickDestination("HTTP");
      const text = snippetText();
      expect(text).toContain("Authorization: Bearer");
      expect(text).toContain("X-Project-Id");
      // Both forms, not one behind a sub-toggle.
      expect(text).toContain("Authorization: Basic");
    });

    /** @scenario JSON config block keeps the existing JsonHighlight wiring */
    it("shows the MCP config and the per-editor paths under MCP config", () => {
      renderDialog();
      pickDestination("MCP config");
      expect(screen.getByTestId("json-config")).toBeInTheDocument();
      expect(
        screen.getByText(/Copy the config path for your editor/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Copy Cursor config path/i }),
      ).toBeInTheDocument();
    });

    /** @scenario One destination's snippet shows at a time */
    it("shows one destination's snippet at a time", () => {
      renderDialog();
      expect(snippetText()).toContain("LANGWATCH_API_KEY=");
      // Claude Code passes the key as `--api-key`, so its command is the clean
      // discriminator: it never contains `LANGWATCH_API_KEY=` the way the .env
      // block does.
      pickDestination("Claude Code");
      const text = snippetText();
      expect(text).toContain("claude mcp add langwatch");
      // The .env snippet is gone, not stacked underneath.
      expect(text).not.toContain("LANGWATCH_API_KEY=");
    });
  });

  describe("given the project a snippet is written for", () => {
    it("threads the active project id into the snippet", () => {
      renderDialog({ projectId: "proj-77" });
      expect(snippetText()).toContain("proj-77");
    });
  });
});
