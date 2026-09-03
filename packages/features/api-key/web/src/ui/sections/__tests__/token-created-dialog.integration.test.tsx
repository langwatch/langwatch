/**
 * @vitest-environment jsdom
 *
 * The one-time reveal, mounted.
 *
 * Consolidates `token-created-uniform` and `token-created-assistants` from
 * `platform/app/src/pages/settings/api-keys/__tests__` onto this package's host
 * harness. THE ONE STRUCTURAL CHANGE is the clipboard: the platform files
 * replaced `navigator.clipboard` and read what it was handed; here the copy goes
 * through the host, and the fake records it. What that buys is the assertion the
 * platform suite could only make indirectly — a copy that the browser REFUSED
 * shows no tick, which is pinned in `apps/ui/tests/api-key-host.adapter.unit.test.ts`.
 *
 * THE MASKING CASES ARE WHY THIS FILE EXISTS. What is DISPLAYED is masked until
 * the reader asks; what is COPIED is always the real value; and the Basic Auth
 * tab masks the BASE64 BLOB rather than the token, because a token is not a
 * substring of its own base64 and masking on it there would fail open.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyHostProvider } from "../../../model/api-key-host";
import { FakeApiKeyHost } from "../../../testing";
import { CODE_ASSISTANTS, TokenCreatedDialog } from "../token-created-dialog";

// Shiki is loaded lazily by the shared adapter; the real wasm highlighter is
// unnecessary for structural assertions.
vi.mock("shiki", () => {
  const highlighter = {
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    getLoadedLanguages: () => ["json", "ini", "bash", "shellscript"],
    loadLanguage: () => Promise.resolve(),
  };
  return {
    bundledLanguagesInfo: [],
    createHighlighter: () => Promise.resolve(highlighter),
    getSingletonHighlighter: () => Promise.resolve(highlighter),
  };
});

const TOKEN = "sk-lw-test-token-value";

function renderDialog(
  overrides: { projectId?: string; orgProjects?: Array<{ id: string; name: string }> } = {},
) {
  const host = new FakeApiKeyHost();
  render(
    <ChakraProvider value={defaultSystem}>
      <ApiKeyHostProvider value={host}>
        <TokenCreatedDialog
          newToken={TOKEN}
          projectId={"projectId" in overrides ? overrides.projectId : "project-abc"}
          endpoint="https://app.langwatch.ai"
          orgProjects={overrides.orgProjects ?? [{ id: "project-abc", name: "ACME" }]}
          onClose={() => void 0}
        />
      </ApiKeyHostProvider>
    </ChakraProvider>,
  );
  return host;
}

function useInCodeSection(): HTMLElement {
  return screen.getByText("Use in Code").closest("div")!.parentElement!;
}

function assistantSection(): HTMLElement {
  return screen.getByText("Use with Code Assistants").closest("div")!.parentElement!;
}

function selectAssistant(label: string) {
  // fireEvent, not a raw .click(): the latter dispatches the event but leaves
  // the resulting setState outside act(), so the tab never repaints.
  fireEvent.click(within(assistantSection()).getByRole("button", { name: label }));
}

async function boxLabelled(label: string): Promise<HTMLElement> {
  const labels = await screen.findAllByText(label);
  return labels.map((element) => element.closest(".code-block__root")).find(Boolean) as HTMLElement;
}

afterEach(cleanup);

describe("given a token has just been minted", () => {
  describe("when the .env tab renders", () => {
    /** @scenario .env tab renders in the shared labelled code preview */
    it("shows a snippet box whose header carries the .env label", async () => {
      renderDialog();
      // ".env" appears once as the tab label and once as the code block's
      // header title — the dialog-local box had no header label at all.
      const labels = await screen.findAllByText(".env");
      expect(labels.length).toBeGreaterThanOrEqual(2);
    });

    /** @scenario All command snippets are syntax-highlighted */
    /** @scenario The dialog renders snippets through the same component as the traces empty state */
    it("renders snippets through the shiki-backed code block, not flat text", async () => {
      renderDialog();
      const box = await boxLabelled(".env");
      // The mocked highlighter wraps output in <pre><code> — reaching the DOM
      // through it proves the snippet went through the shared adapter.
      await vi.waitFor(() => expect(box.querySelector("pre code")).not.toBeNull());
    });

    /** @scenario Long lines scroll horizontally inside the command box */
    it("gives the snippet a horizontally scrollable content area", async () => {
      renderDialog();
      const box = await boxLabelled(".env");
      const content = box.querySelector(".code-block__content") as HTMLElement;
      expect(content).not.toBeNull();
      expect(getComputedStyle(content).overflow).toBe("scroll");
    });

    /** @scenario Copy and reveal buttons coexist in the box header without overlap */
    it("keeps the label, eye toggle and copy button together in the box header", async () => {
      renderDialog();
      const box = await boxLabelled(".env");
      const header = box.querySelector(".code-block__header") as HTMLElement;
      expect(header).not.toBeNull();
      expect(
        within(header).getByRole("button", { name: "Show sensitive values" }),
      ).toBeInTheDocument();
      expect(within(header).getByRole("button", { name: /copy/i })).toBeInTheDocument();
      expect(within(header).getByText(".env")).toBeInTheDocument();
    });
  });

  describe("when the config-file block renders", () => {
    /** @scenario JSON config block keeps the existing JsonHighlight wiring */
    it("shows the MCP config as highlighted JSON with the key masked in it", async () => {
      const host = renderDialog();
      expect(await screen.findByText("Or paste into your config file")).toBeInTheDocument();

      // What is DISPLAYED is the masked key; what the copy button hands over is
      // the real one. Two strings on purpose — see the dialog's own docblock.
      const configCopy = screen.getByRole("button", { name: /copy config/i });
      expect(document.body.textContent).not.toContain(TOKEN);
      fireEvent.click(configCopy);
      expect(host.copies).toHaveLength(1);
      expect(host.copies[0]!.text).toContain(TOKEN);
      expect(host.copies[0]!.text).toContain("@langwatch/mcp-server");
    });

    /** @scenario One list of coding assistants drives both the tabs and the config paths */
    it("draws the tab strip and the config-path chips from the same list", () => {
      renderDialog();
      const configOnly = CODE_ASSISTANTS.filter((assistant) => assistant.configPath);
      for (const assistant of configOnly) {
        // Once as a tab, once as a config-path chip: two renders of one list.
        expect(
          screen.getAllByRole("button", { name: new RegExp(assistant.label) }).length,
        ).toBeGreaterThanOrEqual(2);
      }
      // And nothing is offered as a config path that is not in the list.
      const chips = screen.getAllByRole("button", { name: /Copy .* config path/ });
      expect(chips).toHaveLength(configOnly.length);
    });
  });

  describe("when the Bearer tab is selected", () => {
    /** @scenario Bearer tab renders in the shared labelled code preview */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      fireEvent.click(within(useInCodeSection()).getByRole("button", { name: "Bearer" }));
      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });
  });

  describe("when the Basic Auth tab is selected", () => {
    /** @scenario Basic Auth tab renders in the shared labelled code preview */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      fireEvent.click(within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }));
      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });

    /** @scenario Basic Auth tab without a resolvable project still explains itself */
    it("keeps the helper text and asks for a project when none is resolvable", async () => {
      renderDialog({
        projectId: void 0,
        orgProjects: [
          { id: "project-abc", name: "ACME" },
          { id: "project-def", name: "ACME Staging" },
        ],
      });
      fireEvent.click(within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }));

      expect(await screen.findByText(/Encode the project ID and token as/)).toBeInTheDocument();
      expect(screen.getByText(/Select a project to fill in this header/)).toBeInTheDocument();
      expect(screen.queryByText("HTTP headers")).toBeNull();
    });

    /** @scenario Basic Auth masking hides the encoded credential */
    it("masks the base64-encoded credential, not just the raw token", async () => {
      renderDialog();
      fireEvent.click(within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }));

      const blob = btoa(`project-abc:${TOKEN}`);
      expect(screen.queryByText(new RegExp(blob))).toBeNull();

      const box = await boxLabelled("HTTP headers");
      fireEvent.click(within(box).getByRole("button", { name: "Show sensitive values" }));
      await vi.waitFor(() => expect(box.textContent).toContain(blob));
    });
  });

  describe("when the dialog renders", () => {
    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("keeps the amber copy-this-token-now warning", async () => {
      renderDialog();
      expect(await screen.findByText(/Copy this token now\./)).toBeInTheDocument();
    });

    /** @scenario Reveal toggle still works for masked secret values */
    it("masks the token by default and reveals it on the eye toggle", async () => {
      renderDialog();
      expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();

      const box = await boxLabelled(".env");
      fireEvent.click(within(box).getByRole("button", { name: "Show sensitive values" }));
      await vi.waitFor(() => expect(within(box).queryByText(new RegExp(TOKEN))).not.toBeNull());

      fireEvent.click(within(box).getByRole("button", { name: "Hide sensitive values" }));
      await vi.waitFor(() => expect(within(box).queryByText(new RegExp(TOKEN))).toBeNull());
    });

    /** @scenario Copy delivers the real value even while the snippet is masked */
    it("copies the real command while the snippet is masked", async () => {
      const host = renderDialog();
      const box = await boxLabelled("Terminal");
      expect(box).not.toBeNull();

      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));

      expect(host.copies).toHaveLength(1);
      expect(host.copies[0]!.text).toContain(TOKEN);
      expect(host.copies[0]!.text).toContain("claude mcp add langwatch");
    });
  });

  describe("when the Codex assistant tab is selected", () => {
    /** @scenario Codex tab shows a labelled terminal command snippet */
    it("shows the codex command in a labelled Terminal box", async () => {
      const host = renderDialog();
      selectAssistant("Codex");

      const box = await boxLabelled("Terminal");
      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));
      expect(host.copies[0]!.text).toContain("codex mcp add langwatch");
    });
  });

  describe("when the Claude Code assistant tab renders its command", () => {
    /** @scenario Claude Code tab shows a labelled terminal command snippet */
    it("shows the terminal snippet in a box whose header carries a Terminal label", async () => {
      renderDialog();
      expect(await screen.findByText("Terminal")).toBeInTheDocument();
    });
  });

  describe("when the Use with Code Assistants section renders", () => {
    /** @scenario Every supported coding assistant has a tab */
    it("offers a tab for every assistant the product supports", () => {
      renderDialog();
      for (const assistant of CODE_ASSISTANTS) {
        expect(
          within(assistantSection()).getByRole("button", { name: assistant.label }),
        ).toBeTruthy();
      }
    });

    /** @scenario Every supported coding assistant has a tab */
    it("covers the assistants the customer called out as missing", () => {
      renderDialog();
      for (const label of ["Claude Code", "Codex", "Cursor", "Copilot"]) {
        expect(within(assistantSection()).getByRole("button", { name: label })).toBeTruthy();
      }
    });

    // Intentionally unbound to any spec scenario: this guards a temporary
    // exclusion, not a behaviour the spec describes. Delete it with #6654.
    it("does not offer Gemini until its command is verified (#6654)", () => {
      renderDialog();
      // Gemini's `mcp add` takes its options before the server name and does
      // not use `--` to introduce the command, so the Codex-shaped builder
      // written for it emitted a line that does not run.
      expect(within(assistantSection()).queryByRole("button", { name: "Gemini" })).toBeNull();
    });
  });

  describe("when an assistant that installs from the terminal is selected", () => {
    /** @scenario An assistant with an install command shows a terminal snippet */
    it("brings the terminal treatment back when moving off a config-only tab", () => {
      renderDialog();
      // Claude Code is the default tab and also has a command, so starting from
      // a config-only assistant is what makes the selection measurable.
      selectAssistant("Cursor");
      expect(within(assistantSection()).queryByText("Run in your terminal")).toBeNull();

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
      expect(within(assistantSection()).getByText("Run in your terminal")).toBeTruthy();

      selectAssistant("Windsurf");
      expect(within(assistantSection()).queryByText("Run in your terminal")).toBeNull();
    });
  });
});
