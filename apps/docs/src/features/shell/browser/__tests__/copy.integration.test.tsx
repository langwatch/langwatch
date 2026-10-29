// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../copy.ts";

const writeText = vi.fn<(text: string) => Promise<void>>();
const fetchText = vi.fn<(url: string) => Promise<Response>>();

function frame({ code, hidden = false }: { code: string; hidden?: boolean }) {
  return `<div role="tabpanel" ${hidden ? "hidden" : ""}><div class="docs-code-frame">
    <div><button data-docs-copy="">Copy</button></div>
    <section class="docs-code-region" data-code="${code}"></section></div></div>`;
}

async function click({ selector, index = 0 }: { selector: string; index?: number }) {
  document.querySelectorAll<HTMLButtonElement>(selector)[index]?.click();
  await vi.waitFor(() =>
    expect(writeText.mock.calls.length + fetchText.mock.calls.length).toBeGreaterThan(0),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue();
  fetchText.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("fetch", fetchText);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("when a reader copies a code block", () => {
  /** @scenario "Copy a code block from the code it shows" */
  it("copies the code of the block the button belongs to", async () => {
    document.body.innerHTML = `<div data-scope="tabs" data-part="root">${frame({ code: "first" })}${frame({ code: "second" }).replace('role="tabpanel"', 'class="x"')}</div>`;
    await click({ selector: "[data-docs-copy]", index: 1 });
    expect(writeText).toHaveBeenCalledWith("second");
  });

  /** @scenario "Copy a code block from the code it shows" */
  it("copies the selected tab of a code group", async () => {
    document.body.innerHTML = `<div class="docs-code-frame"><div data-scope="tabs" data-part="root">
      <button data-docs-copy="">Copy</button>
      <div role="tabpanel" hidden><section class="docs-code-region" data-code="python"></section></div>
      <div role="tabpanel"><section class="docs-code-region" data-code="typescript"></section></div>
      </div></div>`;
    await click({ selector: "[data-docs-copy]" });
    expect(writeText).toHaveBeenCalledWith("typescript");
  });
});

describe("when a reader copies a skill's full prompt", () => {
  /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
  it("fetches the prompt file and copies it unchanged", async () => {
    fetchText.mockResolvedValue(new Response("# Prompt\n\n  exact  \n"));
    document.body.innerHTML = `<button data-docs-copy="" data-docs-copy-file="skill-prompts/abc.md">Copy full prompt</button><output></output>`;
    await click({ selector: "[data-docs-copy]" });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("# Prompt\n\n  exact  \n"));
    expect(fetchText.mock.calls[0]?.[0]).toMatch(/\/skill-prompts\/abc\.md$/);
    expect(document.querySelector("output")?.textContent).toBe("Copied to clipboard");
  });

  /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
  it("copies the prompt carried on the button when no file was written", async () => {
    document.body.innerHTML = `<button data-docs-copy="" data-docs-copy-prompt="carried">Copy full prompt</button>`;
    await click({ selector: "[data-docs-copy]" });
    expect(writeText).toHaveBeenCalledWith("carried");
  });

  describe("when the prompt file cannot be fetched", () => {
    /** @scenario "Copy a code block from the code it shows" */
    it("reports that copying failed", async () => {
      fetchText.mockResolvedValue(new Response("missing", { status: 404 }));
      document.body.innerHTML = `<button data-docs-copy="" data-docs-copy-file="skill-prompts/abc.md">Copy full prompt</button><output></output>`;
      await click({ selector: "[data-docs-copy]" });
      await vi.waitFor(() =>
        expect(document.querySelector("output")?.textContent).toBe(
          "Could not copy. Select the text instead.",
        ),
      );
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe("when the browser accepts a promised clipboard item", () => {
    /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
    it("hands the clipboard the fetched text as the click's own write", async () => {
      const write = vi
        .fn<(items: { blob: Promise<Blob> }[]) => Promise<void>>()
        .mockResolvedValue();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText, write },
        configurable: true,
      });
      vi.stubGlobal(
        "ClipboardItem",
        class {
          blob: Promise<Blob>;
          constructor(items: Record<string, Promise<Blob>>) {
            this.blob = items["text/plain"] as Promise<Blob>;
          }
        },
      );
      fetchText.mockResolvedValue(new Response("prompt text"));
      document.body.innerHTML = `<button data-docs-copy="" data-docs-copy-file="skill-prompts/abc.md">Copy full prompt</button>`;
      await click({ selector: "[data-docs-copy]" });
      await vi.waitFor(() => expect(write).toHaveBeenCalled());
      const blob = await write.mock.calls[0]?.[0][0]?.blob;
      expect(await blob?.text()).toBe("prompt text");
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
