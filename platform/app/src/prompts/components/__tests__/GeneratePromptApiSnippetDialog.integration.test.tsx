/**
 * @vitest-environment jsdom
 *
 * The API dialog for a prompt: what it is titled, how it treats the project's
 * API key, and what it offers when there is no key to show.
 *
 * Spec: specs/prompts/prompt-api-snippet-dialog.feature
 */
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shiki is loaded lazily by the code block's adapter; in jsdom the real wasm
// highlighter is slow and adds nothing these assertions read.
vi.mock("shiki", () => ({
  createHighlighter: () =>
    Promise.resolve({
      codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    }),
}));

import { GeneratePromptApiSnippetDialog } from "../GeneratePromptApiSnippetDialog";

const API_KEY = "sk-lw-abcdefghijklmnopqrstuvwx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <MemoryRouter>{children}</MemoryRouter>
  </ChakraProvider>
);

async function openDialog({ apiKey }: { apiKey?: string }) {
  render(
    <GeneratePromptApiSnippetDialog
      promptHandle="support-triage"
      apiKey={apiKey}
      variables={[{ identifier: "customer_name", type: "str" }]}
    >
      <GeneratePromptApiSnippetDialog.Trigger>
        <Button>API</Button>
      </GeneratePromptApiSnippetDialog.Trigger>
    </GeneratePromptApiSnippetDialog>,
    { wrapper: Wrapper },
  );

  fireEvent.click(screen.getByRole("button", { name: "API" }));

  return await screen.findByRole("dialog");
}

describe("the prompt API snippet dialog", () => {
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

  afterEach(() => {
    cleanup();
  });

  describe("given a project with an API key", () => {
    /** @scenario "The dialog is titled for what the code does" */
    it("titles the dialog for the code it shows", async () => {
      await openDialog({ apiKey: API_KEY });

      expect(screen.getByText("Get and use this prompt")).toBeInTheDocument();
    });

    /** @scenario "The API key is hidden until the reader asks to see it" */
    it("masks the key until the reader shows it", async () => {
      const dialog = await openDialog({ apiKey: API_KEY });

      expect(dialog.textContent).not.toContain(API_KEY);
      expect(dialog.textContent).toContain("sk-l***...***uvwx".slice(0, 8));

      fireEvent.click(
        await screen.findByRole("button", { name: "Show sensitive values" }),
      );

      expect(screen.getByRole("dialog").textContent).toContain(API_KEY);
    });

    /** @scenario "Copying always takes the working snippet" */
    it("copies the snippet with the real key while the key is masked", async () => {
      const dialog = await openDialog({ apiKey: API_KEY });

      expect(dialog.textContent).not.toContain(API_KEY);

      fireEvent.click(await screen.findByRole("button", { name: /copy/i }));

      expect(clipboardContents).toContain(API_KEY);
      expect(clipboardContents).not.toContain("***...***");
    });
  });

  describe("given a project with no API key", () => {
    /** @scenario "Without an API key the dialog offers a route to create one" */
    it("offers a route to create one and does not offer the copy", async () => {
      await openDialog({ apiKey: undefined });

      expect(
        screen.getByRole("link", { name: "Create an API key" }),
      ).toHaveAttribute("href", "/settings/api-keys");
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });
});
