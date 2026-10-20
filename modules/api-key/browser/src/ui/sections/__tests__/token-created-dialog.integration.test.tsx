/**
 * @vitest-environment jsdom
 * @see specs/api-keys/token-created-snippets.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeyHostProvider } from "../../../model/api-key-host.ts";
import { FakeApiKeyHost } from "../../../testing.tsx";
import { CODE_ASSISTANTS, TokenCreatedDialog } from "../token-created-dialog.tsx";

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
  overrides: {
    projectId?: string;
    orgProjects?: { id: string; name: string }[];
    keyName?: string;
    copySucceeds?: boolean;
    onClose?: () => void;
  } = {},
) {
  const host = new FakeApiKeyHost({ copySucceeds: overrides.copySucceeds });
  renderWithDesignSystem(
    <ApiKeyHostProvider value={host}>
      <TokenCreatedDialog
        newToken={TOKEN}
        keyName={overrides.keyName}
        projectId={"projectId" in overrides ? overrides.projectId : "project-abc"}
        endpoint="https://app.langwatch.ai"
        orgProjects={overrides.orgProjects ?? [{ id: "project-abc", name: "ACME" }]}
        onClose={overrides.onClose ?? (() => void 0)}
      />
    </ApiKeyHostProvider>,
  );
  return host;
}

function useInCodeSection(): HTMLElement {
  return screen.getByRole("region", { name: "Use in Code" });
}

function assistantSection(): HTMLElement {
  return screen.getByRole("region", { name: "Use with Code Assistants" });
}

/** Zag settles a tab's selection on the next tick, so wait for it rather than assume it. */
async function selectTab(section: HTMLElement, name: string) {
  const tab = within(section).getByRole("tab", { name });
  fireEvent.click(tab);
  await vi.waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
}

function selectAssistant(label: string) {
  return selectTab(assistantSection(), label);
}

async function boxLabelled(label: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const box = screen
      .getAllByText(label)
      .map((element) => element.closest(".code-block__root"))
      .find(Boolean);
    if (!box) throw new Error(`no code box labelled ${label}`);
    return box as HTMLElement;
  });
}

afterEach(cleanup);

describe("given a token has just been minted", () => {
  describe("when the .env tab renders", () => {
    /** @scenario .env tab renders in the shared labelled code preview */
    /** @scenario The secret panel shows the token once with ready-to-copy snippets */
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
      // The content slot carries no slot class since the theme's codeBlock recipe (902a5476c2);
      // it is the element that holds the code.
      const content = box.querySelector(".code-block__code")?.parentElement as HTMLElement;
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
    /** @scenario The secret panel shows the token once with ready-to-copy snippets */
    it("draws the tab strip and the config-path chips from the same list", () => {
      renderDialog();
      const configOnly = CODE_ASSISTANTS.filter((assistant) => assistant.configPath);
      for (const assistant of configOnly) {
        // Once as a tab, once as a config-path chip: two renders of one list.
        expect(screen.getByRole("tab", { name: assistant.label })).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: `Copy ${assistant.label} config path` }),
        ).toBeInTheDocument();
      }
      // And nothing is offered as a config path that is not in the list.
      const chips = screen.getAllByRole("button", { name: /Copy .* config path/ });
      expect(chips).toHaveLength(configOnly.length);
    });
  });

  describe("when the Bearer tab is selected", () => {
    /** @scenario Bearer tab renders in the shared labelled code preview */
    /** @scenario The secret panel shows the token once with ready-to-copy snippets */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      await selectTab(useInCodeSection(), "Bearer");
      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });
  });

  describe("when the Basic Auth tab is selected", () => {
    /** @scenario Basic Auth tab renders in the shared labelled code preview */
    /** @scenario The secret panel shows the token once with ready-to-copy snippets */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      await selectTab(useInCodeSection(), "Basic Auth");
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
      await selectTab(useInCodeSection(), "Basic Auth");

      expect(await screen.findByText(/Encode the project ID and token as/)).toBeInTheDocument();
      expect(screen.getByText(/Select a project to fill in this header/)).toBeInTheDocument();
      expect(screen.queryByText("HTTP headers")).toBeNull();
    });

    /** @scenario Basic Auth masking hides the encoded credential */
    it("masks the base64-encoded credential, not just the raw token", async () => {
      renderDialog();
      await selectTab(useInCodeSection(), "Basic Auth");

      const blob = btoa(`project-abc:${TOKEN}`);
      expect(screen.queryByText(new RegExp(blob))).toBeNull();

      const box = await boxLabelled("HTTP headers");
      fireEvent.click(within(box).getByRole("button", { name: "Show sensitive values" }));
      await vi.waitFor(() => expect(box.textContent).toContain(blob));
    });
  });

  describe("when the member closes it", () => {
    /** @scenario Closing the secret panel needs no confirmation */
    it.each([
      ["the X", () => screen.getByTestId("token-created-dialog-close")],
      ["Done", () => screen.getByTestId("token-created-done")],
    ])(
      "closes at once through %s, with no checkbox or confirmation in the way",
      async (_, pick) => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderDialog({ onClose });

        expect(screen.queryByRole("checkbox")).toBeNull();
        await user.click(pick());

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole("alertdialog")).toBeNull();
      },
    );

    /** @scenario The secret panel's footer shows only Done */
    it("draws Done alone in the footer, with Copy API key taking the focus", async () => {
      // jsdom lays nothing out, so the focus trap would treat every element as hidden.
      const rect = new DOMRect(0, 0, 10, 10);
      const layout = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
        0: rect,
        length: 1,
        item: (index: number) => (index === 0 ? rect : null),
        [Symbol.iterator]: () => [rect][Symbol.iterator](),
      });
      try {
        renderDialog();

        const dialog = screen.getByRole("dialog");
        const footer = Array.from(dialog.querySelectorAll("[data-frame-action]"));
        expect(footer.map((button) => button.textContent)).toEqual(["Done"]);
        expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
        expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
        await vi.waitFor(() => expect(screen.getByTestId("token-created-copy-key")).toHaveFocus());
      } finally {
        layout.mockRestore();
      }
    });

    /** @scenario Closing the secret panel needs no confirmation */
    it("closes on Escape", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDialog({ onClose });

      const dialog = screen.getByRole("dialog");
      await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      await user.keyboard("{Escape}");

      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });
  });

  describe("when the dialog renders", () => {
    /** @scenario Amber warning between .env block and Code Assistants section stays */
    /** @scenario Closing the secret panel needs no confirmation */
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
    /** @scenario The secret panel shows the token once with ready-to-copy snippets */
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
      await selectAssistant("Codex");

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
        expect(within(assistantSection()).getByRole("tab", { name: assistant.label })).toBeTruthy();
      }
    });

    /** @scenario Every supported coding assistant has a tab */
    it("covers the assistants the customer called out as missing", () => {
      renderDialog();
      for (const label of ["Claude Code", "Codex", "Cursor", "Copilot"]) {
        expect(within(assistantSection()).getByRole("tab", { name: label })).toBeTruthy();
      }
    });

    // Intentionally unbound to any spec scenario: this guards a temporary
    // exclusion, not a behaviour the spec describes. Delete it with #6654.
    it("does not offer Gemini until its command is verified (#6654)", () => {
      renderDialog();
      // Gemini's `mcp add` takes its options before the server name and does
      // not use `--` to introduce the command, so the Codex-shaped builder
      // written for it emitted a line that does not run.
      expect(within(assistantSection()).queryByRole("tab", { name: "Gemini" })).toBeNull();
    });
  });

  describe("when an assistant that installs from the terminal is selected", () => {
    /** @scenario An assistant with an install command shows a terminal snippet */
    it("brings the terminal treatment back when moving off a config-only tab", async () => {
      renderDialog();
      // Claude Code is the default tab and also has a command, so starting from
      // a config-only assistant is what makes the selection measurable.
      await selectAssistant("Cursor");
      expect(within(assistantSection()).queryByText("Run in your terminal")).toBeNull();

      await selectAssistant("Codex");
      const codex = assistantSection().textContent ?? "";
      expect(codex).toContain("Run in your terminal");
      expect(codex).not.toContain("has no install command");
    });
  });

  describe("when an assistant with no terminal installer is selected", () => {
    /** @scenario An assistant without an install command points at its config file */
    it("names the config file it reads instead, per assistant", async () => {
      renderDialog();

      await selectAssistant("Cursor");
      const cursor = assistantSection().textContent ?? "";
      expect(cursor).toContain("Cursor has no install command");
      expect(cursor).toContain(".cursor/mcp.json");

      // A second config-only assistant, so the message is shown to follow the
      // selection rather than being the same static string either way.
      await selectAssistant("Windsurf");
      const windsurf = assistantSection().textContent ?? "";
      expect(windsurf).toContain("Windsurf has no install command");
      expect(windsurf).toContain("~/.codeium/windsurf/mcp_config.json");
      expect(windsurf).not.toContain(".cursor/mcp.json");
    });

    /** @scenario An assistant without an install command points at its config file */
    it("drops the terminal heading for it", async () => {
      renderDialog();
      // The default tab has a command, so confirm the heading is there first —
      // otherwise its absence proves nothing about the selection.
      expect(within(assistantSection()).getByText("Run in your terminal")).toBeTruthy();

      await selectAssistant("Windsurf");
      expect(within(assistantSection()).queryByText("Run in your terminal")).toBeNull();
    });
  });

  describe("when the copy button is used", () => {
    /** @scenario Copy button is present on every command box */
    it("gives every rendered command box its own copy button", async () => {
      renderDialog();

      const envBox = await boxLabelled(".env");
      expect(within(envBox).getByRole("button", { name: /copy/i })).toBeInTheDocument();

      await selectTab(useInCodeSection(), "Bearer");
      const bearerBox = await boxLabelled("HTTP headers");
      expect(within(bearerBox).getByRole("button", { name: /copy/i })).toBeInTheDocument();

      await selectAssistant("Codex");
      const terminalBox = await boxLabelled("Terminal");
      expect(within(terminalBox).getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    /** @scenario Copy button flashes a success state on click */
    it("flashes a success state and returns to default after 2 seconds", async () => {
      renderDialog();
      const box = await boxLabelled(".env");
      const copyButton = within(box).getByRole("button", { name: /copy/i });

      vi.useFakeTimers();
      try {
        fireEvent.click(copyButton);
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
    it("hands the host a success notice for the copy", async () => {
      const host = renderDialog();
      const box = await boxLabelled(".env");
      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));

      await vi.waitFor(() => expect(host.copies).toHaveLength(1));
      expect(host.copies[0]!.succeeded).toEqual(
        expect.objectContaining({ title: "Copied", description: expect.stringContaining(".env") }),
      );
    });
  });
});

describe("given a key has just been minted with a name", () => {
  describe("when the dialog opens", () => {
    /** @scenario The named key can be copied on its own */
    it("names the key and shows its value masked, with nothing readable", () => {
      renderDialog({ keyName: "Deploy pipeline" });

      expect(
        within(screen.getByTestId("token-created-key")).getByText("Deploy pipeline"),
      ).toBeTruthy();
      const value = screen.getByTestId("token-created-key-value");
      expect(value.textContent).toBe("sk-lw-••••alue");
      expect(value.textContent).not.toContain(TOKEN);
    });

    /** @scenario The named key can be copied on its own */
    it("falls back to a plain title when the key was created without a name", () => {
      renderDialog({ keyName: "   " });

      expect(within(screen.getByTestId("token-created-key")).getByText("API key")).toBeTruthy();
    });

    /** @scenario The named key can be copied on its own */
    it("copies only the real token from Copy API key while the value is masked", async () => {
      const host = renderDialog({ keyName: "Deploy pipeline" });

      fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

      await vi.waitFor(() => expect(host.copies).toHaveLength(1));
      expect(host.copies[0]!.text).toBe(TOKEN);
      expect(screen.getByTestId("token-created-key-value").textContent).not.toContain(TOKEN);
      await vi.waitFor(() =>
        expect(screen.getByRole("button", { name: "Copy API key" })).toHaveTextContent("Copied"),
      );
    });

    /** @scenario The named key can be copied on its own */
    it("reveals and hides the value on its own toggle", () => {
      renderDialog();

      fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
      expect(screen.getByTestId("token-created-key-value").textContent).toBe(TOKEN);

      fireEvent.click(screen.getByRole("button", { name: "Hide API key" }));
      expect(screen.getByTestId("token-created-key-value").textContent).not.toContain(TOKEN);
    });
  });

  describe("when the clipboard refuses the write", () => {
    /** @scenario A refused copy never claims success */
    it("claims no success, keeps the key on screen and says how to copy by hand", async () => {
      const host = renderDialog({ copySucceeds: false });

      fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

      const notice = await screen.findByTestId("token-created-copy-failed");
      expect(notice).toHaveTextContent("Reveal the value and copy it by hand");
      expect(notice.textContent).not.toContain(TOKEN);
      expect(screen.getByRole("button", { name: "Copy API key" })).not.toHaveTextContent("Copied");
      expect(host.copies).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
      expect(screen.getByTestId("token-created-key-value").textContent).toBe(TOKEN);
    });

    /** @scenario A refused copy never claims success */
    it("fails the same way for a snippet, with no tick on its copy button", async () => {
      renderDialog({ copySucceeds: false });
      const box = await boxLabelled(".env");
      const copyButton = within(box).getByRole("button", { name: /copy/i });

      fireEvent.click(copyButton);

      await screen.findByTestId("token-created-copy-failed");
      expect(copyButton.querySelector("svg.lucide-check")).toBeNull();
    });
  });

  describe("when the tab strips are driven from the keyboard", () => {
    /** @scenario The setup tabs are real tabs */
    it("selects the next code format with the arrow key and keeps the focus on it", async () => {
      const user = userEvent.setup();
      renderDialog();
      const env = within(useInCodeSection()).getByRole("tab", { name: ".env" });
      expect(env).toHaveAttribute("aria-selected", "true");

      env.focus();
      await user.keyboard("{ArrowRight}");

      const bearer = within(useInCodeSection()).getByRole("tab", { name: "Bearer" });
      expect(bearer).toHaveAttribute("aria-selected", "true");
      expect(bearer).toHaveFocus();
      expect(env).toHaveAttribute("aria-selected", "false");
      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });

    /** @scenario The setup tabs are real tabs */
    it("selects an assistant with the arrow key and shows only its setup", async () => {
      const user = userEvent.setup();
      renderDialog();
      const claude = within(assistantSection()).getByRole("tab", { name: "Claude Code" });

      claude.focus();
      await user.keyboard("{ArrowRight}");

      const codex = within(assistantSection()).getByRole("tab", { name: "Codex" });
      expect(codex).toHaveAttribute("aria-selected", "true");
      expect(await boxLabelled("Terminal")).not.toBeNull();
      expect(within(assistantSection()).getByRole("tabpanel")).toHaveTextContent(
        "Run in your terminal",
      );
    });
  });
});

describe("given the projects the new key can reach", () => {
  async function copyEnv(host: FakeApiKeyHost): Promise<string> {
    const box = await boxLabelled(".env");
    fireEvent.click(within(box).getByRole("button", { name: /copy/i }));
    await vi.waitFor(() => expect(host.copies.length).toBeGreaterThan(0));
    return host.copies.at(-1)!.text;
  }

  describe("when there is exactly one, and it is not the current project", () => {
    /** @scenario One reachable project is shown and used */
    it("names that project and fills every snippet with it, never the stale current one", async () => {
      const host = renderDialog({
        projectId: "stale-project",
        orgProjects: [{ id: "project-abc", name: "ACME" }],
      });

      expect(screen.getByTestId("token-created-project")).toHaveTextContent("ACME");
      expect(screen.queryByText("Select project")).toBeNull();

      const env = await copyEnv(host);
      expect(env).toContain('LANGWATCH_PROJECT_ID="project-abc"');
      expect(env).not.toContain("stale-project");

      await selectTab(useInCodeSection(), "Basic Auth");
      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });

    /** @scenario One reachable project is shown and used */
    it("uses the lone project when the screen has no current project at all", async () => {
      const host = renderDialog({
        projectId: void 0,
        orgProjects: [{ id: "project-abc", name: "ACME" }],
      });

      expect(await copyEnv(host)).toContain('LANGWATCH_PROJECT_ID="project-abc"');
    });
  });

  describe("when there are none", () => {
    /** @scenario Zero reachable projects say so and keep the key copyable */
    it.each([
      ["with a current project", "project-abc"],
      ["without one", undefined],
    ])("states the limitation instead of a placeholder, %s", async (_, projectId) => {
      const host = renderDialog({ projectId, orgProjects: [] });

      expect(await screen.findByText(/No project is reachable with this key/)).toBeInTheDocument();
      expect(screen.queryByText("HTTP headers")).toBeNull();
      expect(document.body.textContent).not.toContain("<your-project-id>");
      expect(screen.queryByText("Select project")).toBeNull();
      expect(screen.queryByTestId("token-created-project")).toBeNull();

      await selectTab(useInCodeSection(), "Basic Auth");
      expect(screen.getAllByText(/No project is reachable with this key/)).toHaveLength(1);
      expect(screen.queryByText(/Select a project/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
      await vi.waitFor(() => expect(host.copies.at(-1)?.text).toBe(TOKEN));
    });

    /** @scenario Zero reachable projects say so and keep the key copyable */
    it("copies assistant commands without any project id", async () => {
      const host = renderDialog({ projectId: "project-abc", orgProjects: [] });
      const box = await boxLabelled("Terminal");

      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));

      await vi.waitFor(() => expect(host.copies).toHaveLength(1));
      expect(host.copies[0]!.text).not.toContain("LANGWATCH_PROJECT_ID");
      expect(host.copies[0]!.text).not.toContain("project-abc");
    });
  });

  describe("when there are several", () => {
    const several = [
      { id: "project-abc", name: "ACME" },
      { id: "project-def", name: "ACME Staging" },
    ];

    /** @scenario Several reachable projects offer a real choice */
    it("preselects the current project when it is reachable", async () => {
      const host = renderDialog({ projectId: "project-def", orgProjects: several });

      expect(await copyEnv(host)).toContain('LANGWATCH_PROJECT_ID="project-def"');
    });

    /** @scenario Several reachable projects offer a real choice */
    it("ignores a current project outside the list and asks for a choice", async () => {
      renderDialog({ projectId: "stale-project", orgProjects: several });

      expect(await screen.findByText("Select a project to fill in this file.")).toBeInTheDocument();
      expect(screen.queryByTestId("token-created-project")).toBeNull();
    });

    /** @scenario Several reachable projects offer a real choice */
    it("lists only the reachable projects and switches every snippet when one is picked", async () => {
      const user = userEvent.setup();
      const host = renderDialog({ projectId: "project-abc", orgProjects: several });

      await user.click(screen.getByRole("combobox"));
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual(["ACME", "ACME Staging"]);
      await user.click(screen.getByRole("option", { name: "ACME Staging" }));

      expect(await copyEnv(host)).toContain('LANGWATCH_PROJECT_ID="project-def"');
      const terminal = await boxLabelled("Terminal");
      fireEvent.click(within(terminal).getByRole("button", { name: /copy/i }));
      await vi.waitFor(() =>
        expect(host.copies.at(-1)!.text).toContain("LANGWATCH_PROJECT_ID=project-def"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
      await vi.waitFor(() =>
        expect(host.copies.at(-1)!.text).toContain('"LANGWATCH_PROJECT_ID": "project-def"'),
      );
    });
  });
});

describe("given a second key is minted after the first dialog closed", () => {
  function Reopening({ host }: { host: FakeApiKeyHost }) {
    const [state, setState] = useState<{
      token: string | null;
      projects: { id: string; name: string }[];
    }>({
      token: "sk-lw-first-token-0001",
      projects: [
        { id: "project-abc", name: "ACME" },
        { id: "project-def", name: "ACME Staging" },
      ],
    });
    return (
      <ApiKeyHostProvider value={host}>
        <button
          type="button"
          onClick={() =>
            setState({
              token: "sk-lw-second-token-0002",
              projects: [{ id: "project-xyz", name: "Other" }],
            })
          }
        >
          mint second
        </button>
        <TokenCreatedDialog
          newToken={state.token}
          keyName="Second"
          projectId="project-abc"
          endpoint="https://app.langwatch.ai"
          orgProjects={state.projects}
          onClose={() => setState({ ...state, token: null })}
        />
      </ApiKeyHostProvider>
    );
  }

  /** @scenario Reopening starts from the new key alone */
  it("carries no token, selection, reveal or copy tick over from the first key", async () => {
    const user = userEvent.setup();
    const host = new FakeApiKeyHost();
    renderWithDesignSystem(<Reopening host={host} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "ACME Staging" }));
    await user.click(screen.getByRole("button", { name: "Show API key" }));
    await user.click(screen.getByRole("button", { name: "Copy API key" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy API key" })).toHaveTextContent("Copied"),
    );
    expect(screen.getByTestId("token-created-key-value").textContent).toBe(
      "sk-lw-first-token-0001",
    );

    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByTestId("token-created-key")).toBeNull());
    expect(document.body.textContent).not.toContain("sk-lw-first-token-0001");

    fireEvent.click(screen.getByText("mint second"));
    const value = await screen.findByTestId("token-created-key-value");

    expect(value.textContent).toBe("sk-lw-••••0002");
    expect(screen.getByRole("button", { name: "Show API key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy API key" })).not.toHaveTextContent("Copied");
    expect(screen.getByTestId("token-created-project")).toHaveTextContent("Other");
    expect(document.body.textContent).not.toContain("sk-lw-first-token-0001");
    expect(document.body.textContent).not.toContain("ACME Staging");
  });
});
