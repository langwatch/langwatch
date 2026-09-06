/**
 * @vitest-environment jsdom
 *
 * The Token Created dialog previously rendered snippets through a
 * dialog-local component (ShikiCommandBox) whose header carried no label,
 * diverging from the CodePreview surface the traces empty state and
 * onboarding screens use. These tests pin the uniform design: every
 * snippet block renders in the shared CodePreview with a labelled header.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokenCreatedDialog } from "../TokenCreatedDialog";

// Shiki is loaded lazily by CodePreview's adapter; the real wasm highlighter
// is unnecessary for structural assertions. JsonHighlight reaches shiki
// through the traces-v2 shikiAdapter, which also needs the registry exports.
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

function useInCodeSection(): HTMLElement {
  return screen.getByText("Use in Code").closest("div")!.parentElement!;
}

describe("given a token has just been minted", () => {
  afterEach(cleanup);

  describe("when the .env tab renders", () => {
    /** @scenario .env tab renders in the shared labelled code preview */
    it("shows a snippet box whose header carries the .env label", async () => {
      renderDialog();

      // ".env" appears once as the tab label and once as the CodePreview
      // header title — the dialog-local box had no header label at all.
      const labels = await screen.findAllByText(".env");
      expect(labels.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("when the Bearer tab is selected", () => {
    /** @scenario Bearer tab renders in the shared labelled code preview */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      fireEvent.click(
        within(useInCodeSection()).getByRole("button", { name: "Bearer" }),
      );

      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });
  });

  describe("when the Basic Auth tab is selected", () => {
    /** @scenario Basic Auth tab renders in the shared labelled code preview */
    it("shows a snippet box whose header names the snippet", async () => {
      renderDialog();
      fireEvent.click(
        within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }),
      );

      expect(await screen.findByText("HTTP headers")).toBeInTheDocument();
    });

    /** @scenario Basic Auth tab without a resolvable project still explains itself */
    it("keeps the helper text and asks for a project when none is resolvable", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TokenCreatedDialog
            newToken={TOKEN}
            projectId={undefined}
            endpoint="https://app.langwatch.ai"
            orgProjects={[
              { id: "project-abc", name: "ACME" },
              { id: "project-def", name: "ACME Staging" },
            ]}
            onClose={() => void 0}
          />
        </ChakraProvider>,
      );
      fireEvent.click(
        within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }),
      );

      expect(
        await screen.findByText(/Encode the project ID and token as/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Select a project to fill in this header/),
      ).toBeInTheDocument();
      expect(screen.queryByText("HTTP headers")).toBeNull();
    });

    /** @scenario Basic Auth masking hides the encoded credential */
    it("masks the base64-encoded credential, not just the raw token", async () => {
      renderDialog();
      fireEvent.click(
        within(useInCodeSection()).getByRole("button", { name: "Basic Auth" }),
      );

      const blob = btoa(`project-abc:${TOKEN}`);
      expect(screen.queryByText(new RegExp(blob))).toBeNull();

      const label = await screen.findByText("HTTP headers");
      const box = label.closest(".code-block__root") as HTMLElement;
      fireEvent.click(
        within(box).getByRole("button", { name: "Show sensitive values" }),
      );
      await vi.waitFor(() => {
        expect(box.textContent).toContain(blob);
      });
    });
  });

  describe("when the dialog renders", () => {
    /** @scenario All command snippets are syntax-highlighted */
    it("renders snippets through the shiki-backed code block, not flat text", async () => {
      renderDialog();

      const labels = await screen.findAllByText(".env");
      const box = labels
        .map((el) => el.closest(".code-block__root"))
        .find(Boolean) as HTMLElement;
      expect(box).toBeTruthy();
      // The mocked highlighter wraps output in <pre><code> — reaching the
      // DOM through it proves the snippet went through the shiki adapter.
      await vi.waitFor(() => {
        expect(box.querySelector("pre code")).not.toBeNull();
      });
    });

    /** @scenario Amber warning between .env block and Code Assistants section stays */
    it("keeps the amber copy-this-token-now warning", async () => {
      renderDialog();

      expect(
        await screen.findByText(/Copy this token now\./),
      ).toBeInTheDocument();
    });

    /** @scenario Reveal toggle still works for masked secret values */
    it("masks the token by default and reveals it on the eye toggle", async () => {
      renderDialog();

      expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();

      // Both the .env box and the terminal box carry an eye toggle — scope
      // to the .env box.
      const labels = await screen.findAllByText(".env");
      const box = labels
        .map((el) => el.closest(".code-block__root"))
        .find(Boolean) as HTMLElement;

      fireEvent.click(
        within(box).getByRole("button", { name: "Show sensitive values" }),
      );
      await vi.waitFor(() => {
        expect(within(box).queryByText(new RegExp(TOKEN))).not.toBeNull();
      });

      fireEvent.click(
        within(box).getByRole("button", { name: "Hide sensitive values" }),
      );
      await vi.waitFor(() => {
        expect(within(box).queryByText(new RegExp(TOKEN))).toBeNull();
      });
    });

    /** @scenario Copy and reveal buttons coexist in the box header without overlap */
    it("keeps the label, eye toggle and copy button together in the box header", async () => {
      renderDialog();

      const labels = await screen.findAllByText(".env");
      const box = labels
        .map((el) => el.closest(".code-block__root"))
        .find(Boolean) as HTMLElement;
      const header = box.querySelector(".code-block__header") as HTMLElement;
      expect(header).not.toBeNull();
      expect(
        within(header).getByRole("button", { name: "Show sensitive values" }),
      ).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: /copy/i }),
      ).toBeInTheDocument();
      expect(within(header).getByText(".env")).toBeInTheDocument();
    });

    /** @scenario Long lines scroll horizontally inside the command box */
    it("gives the snippet a horizontally scrollable content area", async () => {
      renderDialog();

      const labels = await screen.findAllByText(".env");
      const box = labels
        .map((el) => el.closest(".code-block__root"))
        .find(Boolean) as HTMLElement;
      const content = box.querySelector(".code-block__content") as HTMLElement;
      expect(content).not.toBeNull();
      expect(getComputedStyle(content).overflow).toBe("scroll");
    });
  });

  describe("when the Codex assistant tab is selected", () => {
    /** @scenario Codex tab shows a labelled terminal command snippet */
    it("shows the codex command in a labelled Terminal box", async () => {
      renderDialog();

      const section = screen
        .getByText("Use with Code Assistants")
        .closest("div")!.parentElement!;
      fireEvent.click(within(section).getByRole("button", { name: "Codex" }));

      const terminalLabel = await screen.findByText("Terminal");
      const box = terminalLabel.closest(".code-block__root") as HTMLElement;
      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));
      expect(clipboardContents).toContain("codex mcp add langwatch");
    });
  });

  describe("when the Claude Code assistant tab renders its command", () => {
    /** @scenario Claude Code tab shows a labelled terminal command snippet */
    it("shows the terminal snippet in a box whose header carries a Terminal label", async () => {
      renderDialog();

      expect(await screen.findByText("Terminal")).toBeInTheDocument();
    });

    /** @scenario Copy delivers the real value even while the snippet is masked */
    it("copies the real command while the snippet is masked", async () => {
      renderDialog();

      const terminalLabel = await screen.findByText("Terminal");
      const box = terminalLabel.closest(".code-block__root") as HTMLElement;
      expect(box).not.toBeNull();

      fireEvent.click(within(box).getByRole("button", { name: /copy/i }));

      expect(clipboardContents).toContain(TOKEN);
      expect(clipboardContents).toContain("claude mcp add langwatch");
    });
  });
});
