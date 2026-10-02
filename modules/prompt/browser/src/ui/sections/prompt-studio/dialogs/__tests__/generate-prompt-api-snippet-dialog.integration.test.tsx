import type * as ApiKeyClient from "@langwatch/api-key-client";
/**
 * @vitest-environment jsdom
 * The API dialog for a prompt: title, the personal access token it creates, and what it offers
 * with no token yet. Spec: specs/prompts/prompt-api-snippet-dialog.feature
 */
import { Button } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shiki is loaded lazily by the code block's adapter; in jsdom the real wasm
// highlighter is slow and adds nothing these assertions read.
vi.mock("shiki", () => ({
  createHighlighter: () =>
    Promise.resolve({
      codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    }),
}));

type MintArgs = Parameters<typeof ApiKeyClient.useMintPersonalToken>[0];
type MintCall = {
  input: ReturnType<typeof ApiKeyClient.personalTokenInput>;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
};

const mint = vi.hoisted(() => ({ calls: [] as MintCall[] }));

// The hook's own suite covers scoping; this double records the real mint input and holds the token.
vi.mock("@langwatch/api-key-client", async () => {
  const actual = await vi.importActual<typeof ApiKeyClient>("@langwatch/api-key-client");
  return {
    ...actual,
    useMintPersonalToken: (args: MintArgs) =>
      useMintDouble({ args, input: actual.personalTokenInput }),
  };
});

function useMintDouble({
  args,
  input,
}: {
  args: MintArgs;
  input: typeof ApiKeyClient.personalTokenInput;
}) {
  const [token, setToken] = useState<string>();
  return {
    token,
    isMinting: false,
    scopeNote: "This token can read prompts in this project and nothing else.",
    mint: () =>
      new Promise<string | undefined>((resolve, reject) => {
        const { organizationId, projectId, name, permissions } = args;
        if (!organizationId || !projectId) return resolve(undefined);
        mint.calls.push({
          input: input({ organizationId, projectId, name, permissions }),
          resolve: (minted) => {
            setToken(minted);
            resolve(minted);
          },
          reject,
        });
      }),
  };
}

import { PromptHostProvider } from "../../../../../model/prompt-host.ts";
import { FakePromptHost } from "../../../../../testing.tsx";
import { GeneratePromptApiSnippetDialog } from "../generate-prompt-api-snippet-dialog.tsx";

const API_KEY = "sk-lw-abcdefghijklmnopqrstuvwx";
const DAY_MS = 24 * 60 * 60 * 1000;

async function openDialog(host = new FakePromptHost()) {
  renderWithDesignSystem(
    <PromptHostProvider value={host}>
      <GeneratePromptApiSnippetDialog
        promptHandle="support-triage"
        variables={[{ identifier: "customer_name", type: "str" }]}
      >
        <GeneratePromptApiSnippetDialog.Trigger>
          <Button>API</Button>
        </GeneratePromptApiSnippetDialog.Trigger>
      </GeneratePromptApiSnippetDialog>
    </PromptHostProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "API" }));

  return screen.findByRole("dialog");
}

async function createToken() {
  fireEvent.click(await screen.findByRole("button", { name: "Create a personal access token" }));
  const [call] = mint.calls;
  if (!call) throw new Error("the dialog did not ask for a token");
  return call;
}

describe("the prompt API snippet dialog", () => {
  let clipboardContents = "";

  beforeEach(() => {
    clipboardContents = "";
    mint.calls = [];
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

  afterEach(() => {
    cleanup();
  });

  describe("given a personal access token created in the dialog", () => {
    /** @scenario "The dialog is titled for what the code does" */
    it("titles the dialog for the code it shows", async () => {
      await openDialog();

      expect(screen.getByText("Get and use this prompt")).toBeInTheDocument();
    });

    /** @scenario "The API key is hidden until the reader asks to see it" */
    it("masks the key until the reader shows it", async () => {
      const dialog = await openDialog();
      const call = await createToken();
      await act(async () => call.resolve(API_KEY));

      expect(dialog.textContent).not.toContain(API_KEY);

      fireEvent.click(await screen.findByRole("button", { name: "Show sensitive values" }));

      expect(screen.getByRole("dialog").textContent).toContain(API_KEY);
    });

    /** @scenario "Copying always takes the working snippet" */
    it("copies the snippet with the real key while the key is masked", async () => {
      await openDialog();
      const call = await createToken();
      await act(async () => call.resolve(API_KEY));

      fireEvent.click(await screen.findByRole("button", { name: "Copy example.py" }));

      expect(clipboardContents).toContain(API_KEY);
      expect(clipboardContents).not.toContain("***...***");
    });
  });

  describe("given no token created yet", () => {
    /** @scenario "Without a token the dialog offers to create a personal access token" */
    it("offers to create one and does not offer the copy", async () => {
      await openDialog();

      expect(
        screen.getByRole("button", { name: "Create a personal access token" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copy example.py" })).toBeNull();
    });

    /** @scenario "A token created in the dialog expires in 90 days" */
    it("creates the token for this project, expiring in 90 days", async () => {
      await openDialog();
      const { input } = await createToken();

      expect(input.bindings).toEqual([expect.objectContaining({ scopeId: "proj-1" })]);
      expect(input.permissions).toEqual(["prompts:view"]);
      const expiresAt = Date.parse(String(input.expiresAt));
      expect(expiresAt - Date.now()).toBeGreaterThan(89 * DAY_MS);
      expect(expiresAt - Date.now()).toBeLessThan(91 * DAY_MS);
    });

    /** @scenario "A failed creation tells the reader" */
    it("tells the reader when the token could not be created", async () => {
      const host = new FakePromptHost();
      await openDialog(host);
      const call = await createToken();
      await act(async () => call.reject(new Error("nope")));

      expect(host.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't create the personal access token" }),
      ]);
      expect(screen.queryByRole("button", { name: "Copy example.py" })).toBeNull();
    });
  });
});
