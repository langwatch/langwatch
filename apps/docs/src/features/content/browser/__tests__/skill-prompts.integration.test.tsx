// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fillOpenPrompts } from "../skill-prompts.ts";

const fetchFragment = vi.fn<(url: string) => Promise<Response>>();
const FRAGMENT = "/docs/assets/skill-prompt-0123456789abcdef.html";

function prompt({ open = false }: { open?: boolean } = {}) {
  document.body.innerHTML = `<details class="docs-skill-prompt"${open ? " open" : ""}>
    <summary>View prompt</summary>
    <div class="docs-skill-body" data-docs-prompt-fragment="${FRAGMENT}"><p>Preview</p>
    <p><a href="/docs/skill-prompts/x.md">Read the full prompt</a></p></div></details>`;
  return document.querySelector<HTMLDetailsElement>("details")!;
}

function body() {
  return document.querySelector<HTMLElement>(".docs-skill-body")!;
}

async function toggle({ details, open }: { details: HTMLDetailsElement; open: boolean }) {
  details.open = open;
  await new Promise((resolve) => details.addEventListener("toggle", resolve, { once: true }));
}

beforeEach(() => {
  fetchFragment.mockReset();
  vi.stubGlobal("fetch", fetchFragment);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("when a reader opens a skill prompt", () => {
  /** @scenario "Fill a skill prompt from its fragment the first time it opens" */
  it("replaces the preview with the fetched body and keeps the disclosure open", async () => {
    fetchFragment.mockResolvedValue(new Response("<p>Full body</p><ul><li>Step</li></ul>"));
    const details = prompt();
    await toggle({ details, open: true });
    await vi.waitFor(() => expect(body().innerHTML).toBe("<p>Full body</p><ul><li>Step</li></ul>"));
    expect(fetchFragment).toHaveBeenCalledWith(FRAGMENT, { credentials: "omit" });
    expect(details.open).toBe(true);
  });

  /** @scenario "Fill a skill prompt from its fragment the first time it opens" */
  it("enables the copy buttons of the code blocks it brings", async () => {
    fetchFragment.mockResolvedValue(
      new Response(
        '<div class="docs-code-frame"><button disabled data-docs-copy="">Copy</button></div>',
      ),
    );
    const details = prompt();
    await toggle({ details, open: true });
    await vi.waitFor(() => expect(body().querySelector("button")?.disabled).toBe(false));
  });

  /** @scenario "Fill a skill prompt from its fragment the first time it opens" */
  it("fetches the body once across later opens", async () => {
    fetchFragment.mockResolvedValue(new Response("<p>Full body</p>"));
    const details = prompt();
    await toggle({ details, open: true });
    await vi.waitFor(() => expect(body().textContent).toBe("Full body"));
    await toggle({ details, open: false });
    await toggle({ details, open: true });
    expect(fetchFragment).toHaveBeenCalledTimes(1);
  });

  describe("when the prompt opened before its script loaded", () => {
    /** @scenario "Fill a skill prompt from its fragment the first time it opens" */
    it("fills the prompt that is already open", async () => {
      fetchFragment.mockResolvedValue(new Response("<p>Full body</p>"));
      prompt({ open: true });
      fillOpenPrompts();
      await vi.waitFor(() => expect(body().textContent).toBe("Full body"));
    });
  });

  describe("when the fragment cannot be fetched", () => {
    /** @scenario "Fill a skill prompt from its fragment the first time it opens" */
    it("keeps the preview and link and retries on the next open", async () => {
      fetchFragment
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockResolvedValueOnce(new Response("<p>Full body</p>"));
      const details = prompt();
      await toggle({ details, open: true });
      await vi.waitFor(() => expect(body().hasAttribute("data-docs-prompt-fragment")).toBe(true));
      expect(body().textContent).toContain("Read the full prompt");
      await toggle({ details, open: false });
      await toggle({ details, open: true });
      await vi.waitFor(() => expect(body().textContent).toBe("Full body"));
      expect(fetchFragment).toHaveBeenCalledTimes(2);
    });
  });
});
