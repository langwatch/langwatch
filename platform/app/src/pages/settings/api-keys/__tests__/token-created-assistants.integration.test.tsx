/**
 * @vitest-environment jsdom
 *
 * The "Use with Code Assistants" section offered two tabs — Claude Code and
 * Codex — while the product documents the LangWatch MCP server for more
 * assistants than that, and the same file listed five *different* editors for
 * its config-path chips. A customer noticed the gap.
 *
 * These drive the rendered dialog: pick a tab, read what the user is shown.
 * The registry's own shape (what each entry builds) is asserted in
 * token-created-snippets.unit.test.ts, where it costs no render.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CODE_ASSISTANTS, TokenCreatedDialog } from "../TokenCreatedDialog";

const TOKEN = "sk-lw-test-token-value";

function renderDialog() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TokenCreatedDialog
        newToken={TOKEN}
        projectId="project-abc"
        endpoint="https://app.langwatch.ai"
        orgProjects={[{ id: "project-abc", name: "ACME" }]}
        onClose={() => void 0}
      />
    </ChakraProvider>,
  );
}

/** The "Use with Code Assistants" block, tabs and body together. */
function assistantSection(): HTMLElement {
  return screen.getByText("Use with Code Assistants").closest("div")!
    .parentElement!;
}

function selectAssistant(label: string) {
  // fireEvent, not a raw .click(): the latter dispatches the event but leaves
  // the resulting setState outside act(), so the tab never repaints.
  fireEvent.click(
    within(assistantSection()).getByRole("button", { name: label }),
  );
}

describe("given a token has just been minted", () => {
  afterEach(cleanup);

  describe("when the Use with Code Assistants section renders", () => {
    /** @scenario Every supported coding assistant has a tab */
    it("offers a tab for every assistant the product supports", () => {
      renderDialog();

      for (const assistant of CODE_ASSISTANTS) {
        expect(
          within(assistantSection()).getByRole("button", {
            name: assistant.label,
          }),
        ).toBeTruthy();
      }
    });

    /** @scenario Every supported coding assistant has a tab */
    it("covers the assistants the customer called out as missing", () => {
      renderDialog();

      for (const label of ["Claude Code", "Codex", "Cursor", "Copilot"]) {
        expect(
          within(assistantSection()).getByRole("button", { name: label }),
        ).toBeTruthy();
      }
    });

    // Intentionally unbound to any spec scenario: this guards a temporary
    // exclusion, not a behaviour the spec describes. Delete it with #6654.
    it("does not offer Gemini until its command is verified (#6654)", () => {
      renderDialog();

      // Gemini's `mcp add` takes its options before the server name and does
      // not use `--` to introduce the command, so the Codex-shaped builder
      // written for it emitted a line that does not run.
      expect(
        within(assistantSection()).queryByRole("button", { name: "Gemini" }),
      ).toBeNull();
    });
  });

  describe("when an assistant that installs from the terminal is selected", () => {
    // The command STRING itself cannot be asserted here: ShikiCommandBox is
    // loaded via `dynamic(..., { ssr: false })` and renders nothing in jsdom,
    // so no `codex mcp add …` text ever reaches the DOM. Each assistant's
    // exact command is pinned in token-created-snippets.unit.test.ts instead;
    // these prove the tab switches which of the two treatments is shown.

    /** @scenario An assistant with an install command shows a terminal snippet */
    it("brings the terminal treatment back when moving off a config-only tab", () => {
      renderDialog();

      // Claude Code is the default tab and also has a command, so starting
      // from a config-only assistant is what makes the selection measurable.
      selectAssistant("Cursor");
      expect(
        within(assistantSection()).queryByText("Run in your terminal"),
      ).toBeNull();

      selectAssistant("Codex");
      const codex = assistantSection().textContent ?? "";
      expect(codex).toContain("Run in your terminal");
      expect(codex).not.toContain("has no install command");
    });
  });

  describe("when an assistant with no terminal installer is selected", () => {
    /** @scenario An assistant without an install command points at its config file */
    it("names the config file it reads instead, per assistant", () => {
      renderDialog();

      selectAssistant("Cursor");
      const cursor = assistantSection().textContent ?? "";
      expect(cursor).toContain("Cursor has no install command");
      expect(cursor).toContain(".cursor/mcp.json");

      // A second config-only assistant, so the message is shown to follow the
      // selection rather than being the same static string either way.
      selectAssistant("Windsurf");
      const windsurf = assistantSection().textContent ?? "";
      expect(windsurf).toContain("Windsurf has no install command");
      expect(windsurf).toContain("~/.codeium/windsurf/mcp_config.json");
      expect(windsurf).not.toContain(".cursor/mcp.json");
    });

    /** @scenario An assistant without an install command points at its config file */
    it("drops the terminal heading for it", () => {
      renderDialog();
      // The default tab has a command, so confirm the heading is there first —
      // otherwise its absence proves nothing about the selection.
      expect(
        within(assistantSection()).getByText("Run in your terminal"),
      ).toBeTruthy();

      selectAssistant("Windsurf");
      expect(
        within(assistantSection()).queryByText("Run in your terminal"),
      ).toBeNull();
    });
  });
});
